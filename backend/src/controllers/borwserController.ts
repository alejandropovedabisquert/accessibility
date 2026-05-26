import { Request, Response } from 'express';
import { chromium, firefox, webkit } from 'playwright';

export const getBrowsers = (_req: Request, res: Response) => {
    const browsers = [
        {
            id: chromium.name(),
            name: 'Chromium',
        },
        {
            id: firefox.name(),
            name: 'Firefox',
        },
        {
            id: webkit.name(),
            name: 'WebKit',
        },
    ];

    res.status(200).json(browsers);
};