import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

export type TourPage = 'home' | 'workspace'

type TourStep = {
  id: string
  page: TourPage
  target: string
  title: string
  description: string
  introducedIn: number
}

type TourProgress = {
  completedVersion: number
  seenStepIds: string[]
}

type Highlight = {
  top: number
  left: number
  width: number
  height: number
}

const TOUR_VERSION = 1
const STORAGE_KEY = 'sub2api.productTour'
const TARGET_WAIT_MS = 1800
const HIGHLIGHT_PADDING = 6
const CARD_SPACE = 238

const steps: TourStep[] = [
  { id: 'activation-code', page: 'home', target: 'activation-code', title: '激活或续充设备', description: '在这里输入卡密。首次使用会激活当前设备，已有账号时则会增加可用额度。', introducedIn: 1 },
  { id: 'activation-submit', page: 'home', target: 'activation-submit', title: '提交卡密', description: '输入有效卡密后点击此处，客户端会验证卡密并安全保存当前设备的账号。', introducedIn: 1 },
  { id: 'open-workspace', page: 'home', target: 'open-workspace', title: '进入工作区', description: '账号激活后，从这里进入工作区查看额度、选择分组并配置 Codex。', introducedIn: 1 },
  { id: 'api-groups', page: 'workspace', target: 'api-groups', title: '选择 API 密钥分组', description: '选择适合的服务分组。当前分组会决定 API 密钥使用的平台和倍率。', introducedIn: 1 },
  { id: 'usage-summary', page: 'workspace', target: 'usage-summary', title: '查看剩余额度', description: '这里汇总当前套餐、剩余额度、已用额度和最近同步时间。', introducedIn: 1 },
  { id: 'account-config', page: 'workspace', target: 'account-config', title: '配置 Codex', description: '确认账号状态后，可一键应用当前账号的 Codex 配置，也可以恢复原来的官方配置。', introducedIn: 1 },
  { id: 'recharge', page: 'workspace', target: 'recharge', title: '随时增加额度', description: '新的卡密可以直接充值到当前设备账号，不需要重新激活。', introducedIn: 1 },
  { id: 'usage-details', page: 'workspace', target: 'usage-details', title: '检查用量明细', description: '展开这里可查看每次调用的模型、时间以及输入和输出 Token。', introducedIn: 1 },
]

function readProgress(): TourProgress {
  try {
    const value = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}') as Partial<TourProgress>
    return {
      completedVersion: Number.isInteger(value.completedVersion) ? Math.max(0, value.completedVersion!) : 0,
      seenStepIds: Array.isArray(value.seenStepIds) ? value.seenStepIds.filter((id): id is string => typeof id === 'string') : [],
    }
  } catch {
    return { completedVersion: 0, seenStepIds: [] }
  }
}

function writeProgress(progress: TourProgress) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(progress))
  } catch {
    // The tour remains usable for this session when browser storage is unavailable.
  }
}

export default function ProductTour({ page, onPageChange }: { page: TourPage; onPageChange: (page: TourPage) => void }) {
  const [tourSteps] = useState(() => {
    const progress = readProgress()
    const seen = new Set(progress.seenStepIds)
    return steps.filter((step) => step.introducedIn > progress.completedVersion && !seen.has(step.id))
  })
  const [index, setIndex] = useState(0)
  const [highlight, setHighlight] = useState<Highlight | null>(null)
  const cardRef = useRef<HTMLElement>(null)
  const targetRef = useRef<HTMLElement | null>(null)
  const frameRef = useRef<number | null>(null)
  const previousFocusRef = useRef<HTMLElement | null>(null)
  const step = tourSteps[index]

  const finishStep = (stepId: string, final = false) => {
    const progress = readProgress()
    const seen = new Set(progress.seenStepIds)
    seen.add(stepId)
    const allCurrentStepsSeen = steps.every((item) => item.introducedIn <= progress.completedVersion || item.introducedIn > TOUR_VERSION || seen.has(item.id))
    writeProgress({
      completedVersion: final && allCurrentStepsSeen ? TOUR_VERSION : progress.completedVersion,
      seenStepIds: [...seen],
    })
  }

  const advance = () => {
    if (!step) return
    const final = index === tourSteps.length - 1
    const nextStep = tourSteps[index + 1]
    finishStep(step.id, final)
    setHighlight(null)
    setIndex((current) => current + 1)
    if (nextStep && nextStep.page !== page) onPageChange(nextStep.page)
  }

  const skipMissingTarget = () => {
    if (!step) return
    finishStep(step.id, index === tourSteps.length - 1)
    setHighlight(null)
    setIndex((current) => current + 1)
  }

  const goBack = () => {
    const previousStep = tourSteps[index - 1]
    if (!previousStep) return
    setHighlight(null)
    setIndex((current) => current - 1)
    if (previousStep.page !== page) onPageChange(previousStep.page)
  }

  const skip = () => {
    const progress = readProgress()
    const seen = new Set(progress.seenStepIds)
    for (const item of steps) if (item.introducedIn <= TOUR_VERSION) seen.add(item.id)
    writeProgress({ completedVersion: TOUR_VERSION, seenStepIds: [...seen] })
    setHighlight(null)
    setIndex(tourSteps.length)
  }

  useEffect(() => {
    if (!step || step.page !== page) {
      targetRef.current = null
      setHighlight(null)
      return
    }

    let disposed = false
    let resizeObserver: ResizeObserver | null = null
    const measure = () => {
      if (frameRef.current !== null) cancelAnimationFrame(frameRef.current)
      frameRef.current = requestAnimationFrame(() => {
        frameRef.current = null
        const target = targetRef.current
        if (!target || !target.isConnected) return
        const rect = target.getBoundingClientRect()
        const top = Math.max(4, rect.top - HIGHLIGHT_PADDING)
        const left = Math.max(4, rect.left - HIGHLIGHT_PADDING)
        setHighlight({
          top,
          left,
          width: Math.max(0, Math.min(window.innerWidth - left - 4, rect.width + HIGHLIGHT_PADDING * 2)),
          height: Math.max(0, Math.min(window.innerHeight - top - 4, rect.height + HIGHLIGHT_PADDING * 2)),
        })
      })
    }
    const attach = (target: HTMLElement) => {
      resizeObserver?.disconnect()
      targetRef.current = target
      target.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'smooth' })
      resizeObserver = new ResizeObserver(measure)
      resizeObserver.observe(target)
      measure()
    }
    const findTarget = () => {
      const target = document.querySelector<HTMLElement>(`[data-tour-id="${step.target}"]`)
      if (target && target !== targetRef.current) attach(target)
    }

    findTarget()
    const mutationObserver = new MutationObserver(findTarget)
    mutationObserver.observe(document.body, { childList: true, subtree: true })
    const timeout = window.setTimeout(() => {
      if (!disposed && !targetRef.current) skipMissingTarget()
    }, TARGET_WAIT_MS)
    window.addEventListener('resize', measure)
    window.addEventListener('scroll', measure, true)

    return () => {
      disposed = true
      window.clearTimeout(timeout)
      mutationObserver.disconnect()
      resizeObserver?.disconnect()
      window.removeEventListener('resize', measure)
      window.removeEventListener('scroll', measure, true)
      if (frameRef.current !== null) cancelAnimationFrame(frameRef.current)
      frameRef.current = null
      targetRef.current = null
    }
  }, [page, step?.id])

  useEffect(() => {
    if (!highlight) return
    previousFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
    cardRef.current?.focus()
    return () => previousFocusRef.current?.focus()
  }, [step?.id, !!highlight])

  useEffect(() => {
    if (!highlight) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') skip()
      if (event.key === 'ArrowLeft' && index > 0) goBack()
      if (event.key === 'ArrowRight' || event.key === 'Enter') advance()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [highlight, index, step?.id])

  if (!step || step.page !== page || !highlight) return null

  const cardWidth = Math.min(360, window.innerWidth - 24)
  const cardLeft = Math.max(12, Math.min(window.innerWidth - cardWidth - 12, highlight.left + highlight.width / 2 - cardWidth / 2))
  const canPlaceBelow = highlight.top + highlight.height + CARD_SPACE < window.innerHeight
  const canPlaceAbove = highlight.top > CARD_SPACE
  const placeAbove = !canPlaceBelow && canPlaceAbove
  const cardTop = placeAbove ? highlight.top - 14 : canPlaceBelow ? highlight.top + highlight.height + 14 : 12

  return createPortal(
    <div className="product-tour" aria-live="polite">
      <svg className="tour-mask" width="100%" height="100%" aria-hidden="true">
        <defs>
          <mask id="product-tour-cutout">
            <rect width="100%" height="100%" fill="white" />
            <rect x={highlight.left} y={highlight.top} width={highlight.width} height={highlight.height} rx="16" fill="black" />
          </mask>
        </defs>
        <rect width="100%" height="100%" fill="rgba(28, 27, 24, .72)" mask="url(#product-tour-cutout)" />
      </svg>
      <div className="tour-highlight" style={{ top: highlight.top, left: highlight.left, width: highlight.width, height: highlight.height }} />
      <section
        ref={cardRef}
        className={`tour-card${placeAbove ? ' is-above' : ''}`}
        style={{ top: cardTop, left: cardLeft, width: cardWidth }}
        role="dialog"
        aria-modal="true"
        aria-labelledby="tour-title"
        aria-describedby="tour-description"
        tabIndex={-1}
      >
        <div className="tour-progress"><span>快速引导</span><strong>{index + 1} / {tourSteps.length}</strong></div>
        <h2 id="tour-title">{step.title}</h2>
        <p id="tour-description">{step.description}</p>
        <div className="tour-actions">
          <button className="tour-skip" onClick={skip}>跳过</button>
          <div>
            <button onClick={goBack} disabled={index === 0}>上一步</button>
            <button className="tour-next" onClick={advance}>{index === tourSteps.length - 1 ? '完成' : '下一步'}</button>
          </div>
        </div>
      </section>
    </div>,
    document.body,
  )
}
