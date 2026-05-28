import { ScanResults } from "./scanResult.type";

type ScanWorkflowInput = {
    urls: string[];
    browser?: string;
    device?: string;
};

type ScanWorkflowResult = {
    timestamp: string;
    url: string;
    results: ScanResults[];
};

export { ScanWorkflowInput, ScanWorkflowResult };