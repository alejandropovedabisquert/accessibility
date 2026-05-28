import scanService from "./scan.service";
import storageService from "../storage/storage.service";
import { normalizeUrl, parseUrl, removeHttpProtocol } from "../../utils/url";
import { AppError } from "../../middlewares/errorHandler";
import { ScanWorkflowInput, ScanWorkflowResult } from "../../types/scanWorkflow.type";

class ScanWorkflowService {
    async execute(input: ScanWorkflowInput): Promise<ScanWorkflowResult> {
        if (!input.urls || input.urls.length === 0) {
            const err = new Error("url is required in request body") as AppError;
            err.status = 400;
            throw err;
        }

        const browserName = input.browser || "chromium";

        const normalizedUrls = input.urls.map((rawUrl) => {
            const parsed = parseUrl(rawUrl);

            if (!["http:", "https:"].includes(parsed.protocol)) {
                const err = new Error("only http and https protocols are allowed") as AppError;
                err.status = 400;
                throw err;
            }

            return parsed.toString();
        });

        const results = await Promise.all(
            normalizedUrls.map((url) =>
                scanService.enqueueScan(url, browserName, input.device)
            )
        );

        const output: ScanWorkflowResult = {
            timestamp: new Date().toISOString(),
            url: removeHttpProtocol(normalizeUrl(results[0].url)),
            results,
        };

        await Promise.all(
            output.results.map((res) => storageService.enqueueReport({
                timestamp: output.timestamp,
                url: output.url,
                results: [res],
            }))
        );

        return output;
    }
}

export default new ScanWorkflowService();