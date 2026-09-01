import type { NextFunction, Request, RequestHandler, Response } from 'express';

/**
 * Express 5 ya propaga rechazos de promesas, pero envolver los handlers deja
 * explicito que son asincronos y mantiene el tipado limpio.
 */
export const asyncHandler =
  <P, ResBody, ReqBody, ReqQuery>(
    handler: (
      req: Request<P, ResBody, ReqBody, ReqQuery>,
      res: Response<ResBody>,
      next: NextFunction
    ) => Promise<unknown> | unknown
  ): RequestHandler<P, ResBody, ReqBody, ReqQuery> =>
  (req, res, next) => {
    void Promise.resolve(handler(req, res, next)).catch(next);
  };
