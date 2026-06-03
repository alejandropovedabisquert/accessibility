import scanService from "./scan.service";
import storageService from "../storage/storage.service";
import { normalizeUrl, parseUrl, removeHttpProtocol } from "../../utils/url";
import { AppError } from "../../middlewares/errorHandler";
import { ScanResults } from "../../types/scanResult.type";
import { ScanWorkflowFailure, ScanWorkflowInput, ScanWorkflowResult } from "../../types/scanWorkflow.type";

class ScanWorkflowService {
    async execute(input: ScanWorkflowInput): Promise<ScanWorkflowResult> {
        if (!input.urls || input.urls.length === 0) {
            const err = new Error("Urls is required in request body") as AppError;
            err.status = 400;
            throw err;
        }

        const normalizedUrls = input.urls.map((rawUrl) => {
            const parsed = parseUrl(rawUrl);

            if (!["http:", "https:"].includes(parsed.protocol)) {
                const err = new Error("Only http and https protocols are allowed") as AppError;
                err.status = 400;
                throw err;
            }

            return parsed.toString();
        });

        const settledResults = await Promise.allSettled(
            normalizedUrls.map((url) =>
                scanService.enqueueScan({
                    url,
                    browserName: input.browser,
                    deviceName: input.device,
                    timeoutMs: input.timeout,
                    waitUntil: input.waitUntil,
                    viewport: input.viewport,
                })
            )
        );

        const results: ScanResults[] = [];
        const failures: ScanWorkflowFailure[] = [];

        settledResults.forEach((result, index) => {
            if (result.status === "fulfilled") {
                results.push(result.value);
                return;
            }

            failures.push({
                url: normalizedUrls[index],
                error: result.reason instanceof Error ? result.reason.message : String(result.reason),
            });
        });

        const output: ScanWorkflowResult = {
            timestamp: new Date().toISOString(),
            url: removeHttpProtocol(normalizeUrl(normalizedUrls[0])),
            results,
            failures,
        };

        if (output.results.length > 0) {
            await Promise.all(
                output.results.map((res) => storageService.enqueueReport({
                    timestamp: output.timestamp,
                    url: output.url,
                    results: [res],
                    failures: [],
                }))
            );
        }

        return output;
    }
}

export default new ScanWorkflowService();