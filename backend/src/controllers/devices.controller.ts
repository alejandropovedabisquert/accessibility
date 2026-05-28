import { Request, Response } from 'express';
import { devices } from 'playwright';

export const getDevices = (req: Request, res: Response) => {
    const deviceList = Object.keys(devices).map(name => ({
        name,
        ...devices[name],
    }));
    res.status(200).json(deviceList);
};