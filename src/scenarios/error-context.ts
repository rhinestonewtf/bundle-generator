export type ScenarioError = {
  status?: number
  code?: string
  message: string
}

/** Preserve orchestrator status/code/message even when the SDK wraps response data. */
export const toErrorContext = (error: unknown): ScenarioError => {
  const top = error && typeof error === 'object' ? error : undefined
  const responseValue = top && 'response' in top ? top.response : undefined
  const response =
    responseValue && typeof responseValue === 'object'
      ? responseValue
      : undefined
  const dataValue = response && 'data' in response ? response.data : undefined
  const data =
    dataValue && typeof dataValue === 'object' ? dataValue : undefined
  const status =
    data && 'status' in data
      ? data.status
      : response && 'status' in response
        ? response.status
        : top && 'status' in top
          ? top.status
          : undefined
  const code =
    data && 'code' in data
      ? data.code
      : data && 'errorType' in data
        ? data.errorType
        : top && 'code' in top
          ? top.code
          : undefined
  const nestedMessage =
    data && 'message' in data
      ? data.message
      : data && 'error' in data
        ? data.error
        : undefined
  const message =
    typeof nestedMessage === 'string'
      ? nestedMessage
      : error instanceof Error
        ? error.message
        : String(error)
  return {
    ...(typeof status === 'number' ? { status } : {}),
    ...(typeof code === 'string' ? { code } : {}),
    message,
  }
}
