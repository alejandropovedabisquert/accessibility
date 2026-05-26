export function reportHtmlBuilder(reportData: any) {
    const escapeHtml = (value: unknown): string =>
        String(value ?? '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');

    const blockDetails = (item: any) => `
        <div style="border: 1px solid #ccc; margin-bottom: 10px; padding: 10px;">
            <h3>${escapeHtml(item.id)} - ${escapeHtml(item.description)}</h3>
            <p><strong>Impact:</strong> ${escapeHtml(item.impact) ? escapeHtml(item.impact) : 'Undefined'}</p>
            <p><strong>Help description:</strong> ${escapeHtml(item.help)}</p>
            <p><strong>Help url:</strong> <a href="${escapeHtml(item.helpUrl)}" target="_blank">${escapeHtml(item.helpUrl)}</a></p>
            <h4>Nodes:</h4>
            <ul>
                ${item.nodes && item.nodes.length > 0 ? item.nodes.map((node: any) => `
                    <li>
                        <p><strong>HTML:</strong> ${escapeHtml(node.html)}</p>
                        <p><strong>Target:</strong> ${escapeHtml(node.target.join(', '))}</p>
                        <p><strong>Failure Summary:</strong> ${escapeHtml(node.failureSummary)}</p>
                    </li>
                `).join('') : '<li>No nodes available</li>'}
            </ul>
        </div>
    `;

    return `
        <html>
            <head>
                <title>Accessibility Scan Results</title>
            </head>
            <body>
                <h1>Accessibility Scan Results of ${escapeHtml(reportData.scannedUrl)}</h1>
                <p><strong>Timestamp:</strong> ${escapeHtml(reportData.timestamp)}</p>
                <p><strong>Emulated Device:</strong> ${escapeHtml(reportData.emulatedDevice)}</p>
                <p><strong>Used Browser:</strong> ${escapeHtml(reportData.usedBrowser)}</p>
                <h2>Summary</h2>
                <ul>
                    <li>Violations: ${reportData.summary.violations}</li>
                    <li>Passes: ${reportData.summary.passes}</li>
                    <li>Incomplete: ${reportData.summary.incomplete}</li>
                    <li>Inapplicable: ${reportData.summary.inapplicable}</li>
                </ul>
                <h2>Violations Details</h2>
                ${reportData.scanResult.violations.map(blockDetails).join('')}
                <h2>Incomplete Details</h2>
                ${reportData.scanResult.incomplete.map(blockDetails).join('')}
                <h2>Inapplicable Details</h2>
                ${reportData.scanResult.inapplicable.map(blockDetails).join('')}
            </body>
        </html>
    `;
}