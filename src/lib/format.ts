export function formatDateTime(value?: string | null) {
  if (!value) return '未记录'
  return value.replace('T', ' ').replace('Z', '')
}

export function formatNumber(value?: number | null, digits = 2) {
  if (value === null || value === undefined || Number.isNaN(value)) return '-'
  return new Intl.NumberFormat('zh-CN', {
    maximumFractionDigits: digits,
    minimumFractionDigits: digits
  }).format(value)
}

export function formatRows(value?: number | null) {
  if (value === null || value === undefined) return '-'
  return new Intl.NumberFormat('zh-CN').format(value)
}

export function jsonPreview(value: unknown) {
  try {
    return JSON.stringify(value, null, 2)
  } catch {
    return String(value)
  }
}

export function toErrorMessage(error: unknown) {
  if (typeof error === 'object' && error && 'message' in error) {
    const message = String((error as { message: unknown }).message)
    const detail = (error as { detail?: unknown }).detail
    const detailText = extractErrorDetail(detail)
    return detailText ? `${message}：${detailText}` : message
  }
  if (typeof error === 'string') return error
  return '操作失败'
}

function extractErrorDetail(detail: unknown) {
  if (!detail || typeof detail !== 'object') return ''
  const response = (detail as { response?: unknown }).response
  if (response && typeof response === 'object') {
    const error = (response as { error?: unknown }).error
    if (error && typeof error === 'object' && 'message' in error) {
      return String((error as { message: unknown }).message)
    }
    if ('message' in response) return String((response as { message: unknown }).message)
  }
  if ('error' in detail) return String((detail as { error: unknown }).error)
  return ''
}
