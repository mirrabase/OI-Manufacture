class AppError extends Error {
  code: string
  constructor(code: string, message: string) {
    super(message)
    this.name = "AppError"
    this.code = code
  }
}

export { AppError }
