export class HttpError extends Error {
  constructor(status, message, code = 'error') {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export const badRequest = (message) => new HttpError(400, message, 'bad_request');
export const unauthorized = (message = 'Authentication required') => new HttpError(401, message, 'unauthorized');
export const notFound = (message = 'Not found') => new HttpError(404, message, 'not_found');
export const conflict = (message) => new HttpError(409, message, 'conflict');
