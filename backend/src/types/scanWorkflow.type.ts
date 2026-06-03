import { ScanResults } from "./scanResult.type";

type ScanWaitUntil = 'load' | 'domcontentloaded' | 'networkidle';

type ScanBrowser = 'chromium' | 'firefox' | 'webkit';

type ScanViewport = {
    width: number;
    height: number;
};

type ScanWorkflowInput = {
    urls: string[];
    browser?: ScanBrowser;
    device?: string;
    timeout?: number;
    waitUntil?: ScanWaitUntil;
    viewport?: ScanViewport;
};

type ScanWorkflowFailure = {
    url: string;
    error: string;
};

type ScanWorkflowResult = {
    timestamp: string;
    url: string;
    results: ScanResults[];
    failures: ScanWorkflowFailure[];
};

export { ScanViewport, ScanWaitUntil, ScanBrowser, ScanWorkflowInput, ScanWorkflowFailure, ScanWorkflowResult };