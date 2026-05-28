export function reportHtmlBuilder(report: any) {
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

    const blockSummary = (item: any) => `
        <ul>
            <li>Violations: ${escapeHtml(item.violations.length)}</li>
            <li>Passes: ${escapeHtml(item.passes.length)}</li>
            <li>Incomplete: ${escapeHtml(item.incomplete.length)}</li>
            <li>Inapplicable: ${escapeHtml(item.inapplicable.length)}</li>
        </ul>
    `;

    const blockAllReport = (item: any) => `
        <h2>Summary</h2>
        ${blockSummary(item)}
        <h2>Violations Details</h2>
        ${item.violations.map(blockDetails).join('')}
        <h2>Incomplete Details</h2>
        ${item.incomplete.map(blockDetails).join('')}
        <h2>Inapplicable Details</h2>
        ${item.inapplicable.map(blockDetails).join('')}
    `;

    // <p><strong>Emulated Device:</strong> ${escapeHtml(report.emulatedDevice)}</p>
    // <p><strong>Used Browser:</strong> ${escapeHtml(report.usedBrowser)}</p>
    return `
        <html>
            <head>
                <title>Accessibility Scan Results</title>
            </head>
            <body>
                <h1>Accessibility Scan Results of ${escapeHtml(report.url)}</h1>
                <p><strong>Timestamp:</strong> ${escapeHtml(report.timestamp)}</p>
                ${blockAllReport(report)}
            </body>
        </html>
    `;
}