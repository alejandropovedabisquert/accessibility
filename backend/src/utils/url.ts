import { AppError } from "../middlewares/errorHandler";

export const removeHttpProtocol = (url: string): string => {
    return url.replace(/^https?:\/\//, '').replace(/\/$/, '');
}

export const parseUrl = (url: string): URL => {
    try {
        return new URL(url);
    } catch {
        const err = new Error('url is not valid') as AppError;
        err.status = 400;
        throw err;
    }
}

export const normalizeUrl = (url: string): string => {
    const parsedUrl = parseUrl(url);
    return `${parsedUrl.protocol}//${parsedUrl.hostname}`;
}