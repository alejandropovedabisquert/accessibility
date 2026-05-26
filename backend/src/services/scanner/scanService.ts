import { AxeBuilder } from "@axe-core/playwright";
import { devices } from 'playwright';
import { setBrowserOptions } from "./setBrowserOptions";

class ScanService {
    constructor() {}
    async runScan(url: string, browserName: string, deviceName?: string) {
        const browser = await setBrowserOptions(browserName);
        const context = await browser.newContext({
            ...deviceName ? { ...devices[deviceName] } : {},
        });
        const page = await context.newPage();

        await page.goto(url);

        const results = await new AxeBuilder({ page })
            .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
            .analyze();
        await browser.close();
        await context.close();
        return results;
    }
}

export default ScanService;