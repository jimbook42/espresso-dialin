export class TransferError extends Error {
  constructor(message, path = '') {
    super(path ? path + ': ' + message : message);
    this.name = 'TransferError';
  }
}

export function transferErrorMessage(error, fallback = 'Transfer failed. Try again.') {
  if (error instanceof TransferError) return error.message;
  if (error?.name === 'QuotaExceededError') return 'There is not enough local storage. Free some space and try again.';
  return fallback;
}
