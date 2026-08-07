import { RequestHandler } from 'express';

// Enrobe un handler asynchrone pour transmettre ses rejets à Express (next).
// Nécessaire avec Express 4, qui n'attrape pas les promesses rejetées.
export function asyncHandler(handler: RequestHandler): RequestHandler {
  return (req, res, next) => {
    Promise.resolve(handler(req, res, next)).catch(next);
  };
}
