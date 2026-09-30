import type {
    AuditConfig,
    AxeResults,
    Compliance,
    ComplianceGroup,
    RuleLevel,
    Viewport,
} from '../../types/audit.types';
import { ruleLevel } from '../audit/levels';

type ReportData = Pick<
    AxeResults,
    'url' | 'timestamp' | 'violations' | 'passes' | 'incomplete' | 'inapplicable'
>;

type ReportSection = 'violations' | 'passes' | 'incomplete' | 'inapplicable';
type ReportItem = AxeResults['violations'][number];

export interface ReportMeta {
    config: AuditConfig;
    score: number | null;
    compliance: Compliance;
    label?: string | null;
    /** Seccion analizada. null = pagina entera. */
    include?: string | null;
    exclude?: string | null;
    /** Pantalla con la que se escaneo esta pagina, no la de la auditoria: puede tener varias. */
    viewport: Viewport | null;
    device: string | null;
}

/**
 * Solo estas secciones se desglosan nodo a nodo en el PDF.
 *
 * `passes` e `inapplicable` se quedan en el resumen: desglosarlos generaba PDFs
 * de cientos de paginas con informacion que nadie acciona.
 */
const DETAILED_SECTIONS: readonly ReportSection[] = ['violations', 'incomplete'];

const COLORS = {
    background: '#c9c4ac',
    text: '#39321b',
    border: '#c69639',
    cardBg: '#e6e1cd',
};

const SECTION_COLORS: Record<ReportSection, string> = {
    violations: '#9b3d2f',
    passes: '#43612f',
    incomplete: '#9a6b1f',
    inapplicable: '#5e5a4d',
};

const SECTIONS: Array<{ key: ReportSection; label: string; detailsId: string }> = [
    { key: 'violations', label: 'Incumplimientos', detailsId: 'violations-details' },
    { key: 'passes', label: 'Superadas', detailsId: 'passes-details' },
    { key: 'incomplete', label: 'Revision manual', detailsId: 'incomplete-details' },
    { key: 'inapplicable', label: 'No aplicables', detailsId: 'inapplicable-details' },
];

const escapeHtml = (value: unknown): string =>
    String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');

const summaryItem = (label: string, count: number, targetId: string, key: ReportSection, percentage: number): string => {
    const safeCount = escapeHtml(count);
    const safePercentage = escapeHtml(percentage.toFixed(1).replace(/\.0$/, ''));
    const markerStyle = `background-color: ${SECTION_COLORS[key]};`;

    if (count > 0) {
        return `
            <li class="summary-item">
                <span class="summary-marker" style="${markerStyle}"></span>
                <a href="#${targetId}" class="summary-link">${label}</a>
                <span class="summary-value">${safeCount}</span>
                <span class="summary-percentage">${safePercentage}%</span>
            </li>
        `;
    }

    return `
        <li class="summary-item">
            <span class="summary-marker" style="${markerStyle}"></span>
            <span>${label}</span>
            <span class="summary-value">${safeCount}</span>
            <span class="summary-percentage">${safePercentage}%</span>
        </li>
    `;
};

const LEVEL_LABEL: Record<RuleLevel, string> = {
    A: 'WCAG A',
    AA: 'WCAG AA',
    AAA: 'WCAG AAA',
    'best-practice': 'Buena practica',
};

const COMPLIANCE_BLOCKS = [
    {
        key: 'legal',
        title: 'Cumplimiento legal (WCAG A y AA)',
        note: 'Lo que exigen la Ley 11/2023 y EN 301 549 (WCAG 2.1 AA; objetivo interno WCAG 2.2 AA).',
    },
    {
        key: 'improvements',
        title: 'Mejoras (WCAG AAA y buenas practicas)',
        note: 'No son exigibles legalmente, pero mejoran la experiencia.',
    },
] as const;

const complianceCard = (title: string, note: string, group: ComplianceGroup): string => {
    if (group.score === null) {
        return `
            <div class="summary-card compliance-card">
                <h3 class="summary-card-title">${escapeHtml(title)}</h3>
                <p class="compliance-note">No evaluado: las normas elegidas no incluyen reglas de este grupo.</p>
            </div>
        `;
    }
    return `
        <div class="summary-card compliance-card">
            <div class="summary-card-header">
                <h3 class="summary-card-title">${escapeHtml(title)}</h3>
                <span class="compliance-score">${escapeHtml(group.score)}%</span>
            </div>
            <p class="compliance-note">${escapeHtml(note)}</p>
            <ul class="meta-list">
                <li><strong>Reglas superadas:</strong> ${escapeHtml(group.passes)} de ${escapeHtml(group.passes + group.violations)}</li>
                <li><strong>Incumplimientos:</strong> ${escapeHtml(group.violations)} (${escapeHtml(group.violationNodes)} elementos)</li>
                <li><strong>Criticos:</strong> ${escapeHtml(group.critical)}</li>
                <li><strong>Graves:</strong> ${escapeHtml(group.serious)}</li>
                <li><strong>Moderados:</strong> ${escapeHtml(group.moderate)}</li>
                <li><strong>Leves:</strong> ${escapeHtml(group.minor)}</li>
                <li><strong>Revision manual:</strong> ${escapeHtml(group.incomplete)}</li>
            </ul>
        </div>
    `;
};

const screenLabel = ({ viewport, device }: Pick<ReportMeta, 'viewport' | 'device'>): string => {
    const size = viewport ? `${viewport.width}x${viewport.height}` : null;
    if (device) return size ? `${device} (${size})` : device;
    return size ?? 'desconocida';
};

const blockCompliance = (compliance: Compliance): string =>
    COMPLIANCE_BLOCKS.map(({ key, title, note }) => complianceCard(title, note, compliance[key])).join('');

const blockDetails = (item: ReportItem): string => {
    const nodes = item.nodes ?? [];
    const impact = item.impact ? String(item.impact).toLowerCase() : 'undefined';

    const impactClassByValue: Record<string, string> = {
        critical: 'impact-critical',
        serious: 'impact-serious',
        moderate: 'impact-moderate',
        minor: 'impact-minor',
        undefined: 'impact-undefined',
    };

    const impactClass = impactClassByValue[impact] ?? 'impact-undefined';

    return `
        <article class="rule-item">
            <h3 class="rule-title">${escapeHtml(item.id)} - ${escapeHtml(item.description)}</h3>
            <p><strong>Nivel:</strong> ${escapeHtml(LEVEL_LABEL[ruleLevel(item.tags ?? [])])}</p>
            <p><strong>Impacto:</strong> <span class="impact-pill ${impactClass}">${item.impact ? escapeHtml(item.impact) : 'Sin definir'}</span></p>
            <p><strong>Como corregirlo:</strong> ${escapeHtml(item.help)}</p>
            <p><strong>Documentacion:</strong> <a href="${escapeHtml(item.helpUrl)}" target="_blank" rel="noopener noreferrer" class="summary-link">${escapeHtml(item.helpUrl)}</a></p>
            <p><strong>Elementos afectados:</strong></p>
            <ul class="node-list">
                ${nodes.length > 0 ? nodes.map((node) => `
                    <li>
                        <p><strong>HTML:</strong></p>
                        <pre class="code-block"><code>${escapeHtml(node.html)}</code></pre>
                        <p><strong>Selectores:</strong></p>
                        <div class="target-list">
                            ${(node.target ?? []).map((selector) => `<code class="selector-code">${escapeHtml(selector)}</code>`).join('') || '<span>Sin selector</span>'}
                        </div>
                        ${node.failureSummary ? `<p><strong>Motivo del fallo:</strong> ${escapeHtml(node.failureSummary)}</p>` : ''}
                        <hr />
                    </li>
                `).join('') : '<li>Sin elementos</li>'}
            </ul>
        </article>
    `;
};

const blockSummary = (report: ReportData): string => `
    ${(() => {
        const total = SECTIONS.reduce((acc, { key }) => acc + report[key].length, 0);

        const chartSegments = SECTIONS
            .map(({ key, label }) => {
                const count = report[key].length;
                if (count === 0 || total === 0) {
                    return '';
                }

                const width = (count / total) * 100;
                return `<span class="summary-segment" title="${escapeHtml(label)}: ${escapeHtml(count)}" style="width: ${width}%; background-color: ${SECTION_COLORS[key]};"></span>`;
            })
            .join('');

        const rows = SECTIONS
            .map(({ key, label, detailsId }) => {
                const count = report[key].length;
                const percentage = total > 0 ? (count / total) * 100 : 0;
                return summaryItem(label, count, detailsId, key, percentage);
            })
            .join('');

        return `
            <div class="summary-card">
                <div class="summary-card-header">
                    <h3 class="summary-card-title">Distribucion del escaneo</h3>
                    <span class="summary-total">Total de comprobaciones: ${escapeHtml(total)}</span>
                </div>
                <div class="summary-chart" role="img" aria-label="Distribucion por tipo de resultado">
                    ${chartSegments || '<span class="summary-segment summary-segment-empty"></span>'}
                </div>
                <ul class="summary-list">${rows}</ul>
            </div>
        `;
    })()}
`;

const detailsSection = (report: ReportData, key: ReportSection, label: string, detailsId: string): string => {
    const items = report[key];
    if (items.length === 0) {
        return '';
    }

    return `
        <section class="report-section">
            <h2 id="${detailsId}" class="section-title">${label}: detalle</h2>
            <div class="section-content">
                ${items.map(blockDetails).join('')}
            </div>
        </section>
    `;
};

const buildStyles = (): string => `
    :root {
        --bg: ${COLORS.background};
        --text: ${COLORS.text};
        --border: ${COLORS.border};
        --card-bg: ${COLORS.cardBg};
    }
    html, body {
        background-color: var(--bg);
        color: var(--text);
        font-family: "Trebuchet MS", "Lucida Sans Unicode", "Lucida Grande", sans-serif;
        -webkit-print-color-adjust: exact;
        print-color-adjust: exact;
    }
    body {
        margin: 0;
        line-height: 1.4;
    }
    .report-shell {
        max-width: 980px;
        margin: 0 auto;
        padding: 24px;
    }
    .report-header {
        border: 1px solid var(--border);
        background: linear-gradient(140deg, var(--card-bg) 0%, #ddd6ba 100%);
        border-radius: 10px;
        padding: 14px 18px;
        margin-bottom: 18px;
        box-shadow: 0 2px 8px rgba(57, 50, 27, 0.12);
    }
    .page-title {
        color: var(--text);
        margin: 0 0 8px;
        font-size: 28px;
        letter-spacing: 0.2px;
    }
    .timestamp {
        margin: 0;
        font-size: 14px;
    }
    .meta-list {
        list-style: none;
        margin: 8px 0 0;
        padding: 0;
        display: flex;
        flex-wrap: wrap;
        gap: 4px 16px;
        font-size: 13px;
    }
    .section-title {
        color: var(--text);
        border-bottom: 1px solid var(--border);
        padding-bottom: 4px;
        margin: 20px 0 10px;
    }
    .report-section {
        margin-bottom: 10px;
    }
    .section-content {
        margin-top: 0;
    }
    .summary-card {
        background-color: var(--card-bg);
        border: 1px solid var(--border);
        border-radius: 8px;
        padding: 14px;
    }
    .summary-card-header {
        display: flex;
        justify-content: space-between;
        align-items: baseline;
        gap: 12px;
    }
    .summary-card-title {
        margin: 0;
    }
    .scope-warning {
        margin: 8px 0 0;
        padding: 8px 10px;
        font-size: 13px;
        border: 1px solid ${SECTION_COLORS.incomplete};
        border-radius: 6px;
        background-color: #efe0bd;
    }
    .compliance-card {
        margin-bottom: 12px;
    }
    .compliance-score {
        font-size: 22px;
        font-weight: 700;
        font-variant-numeric: tabular-nums;
    }
    .compliance-note {
        margin: 4px 0 0;
        font-size: 13px;
    }
    .summary-total {
        font-weight: 600;
        font-size: 13px;
    }
    .summary-chart {
        margin-top: 10px;
        margin-bottom: 12px;
        height: 16px;
        border-radius: 999px;
        overflow: hidden;
        border: 1px solid var(--border);
        background-color: #d9d2b6;
        display: flex;
    }
    .summary-segment {
        height: 100%;
        display: block;
    }
    .summary-segment-empty {
        width: 100%;
        background-color: #d9d2b6;
    }
    .summary-list {
        margin: 0;
        padding: 0;
        list-style: none;
        display: grid;
        grid-template-columns: repeat(2, minmax(220px, 1fr));
        gap: 8px 14px;
    }
    .summary-item {
        display: grid;
        grid-template-columns: 12px 1fr auto auto;
        align-items: center;
        gap: 8px;
        border: 1px solid #d0c6a5;
        border-radius: 6px;
        padding: 8px 10px;
        background-color: #ede8d4;
    }
    .summary-marker {
        width: 10px;
        height: 10px;
        border-radius: 999px;
        display: inline-block;
    }
    .summary-value {
        font-weight: 700;
        font-variant-numeric: tabular-nums;
    }
    .summary-percentage {
        font-size: 12px;
        opacity: 0.9;
        margin-left: 2px;
    }
    .summary-link {
        color: var(--text);
        text-decoration: underline;
        overflow-wrap: anywhere;
        word-break: break-word;
    }
    .rule-item {
        border-bottom: 1px solid #cabf9e;
        margin-bottom: 10px;
        padding: 0 0 8px;
        color: var(--text);
    }
    .section-content .rule-item:last-child {
        border-bottom: 0;
        margin-bottom: 0;
    }
    .rule-title {
        margin: 0 0 4px;
        color: var(--text);
        font-size: 17px;
        overflow-wrap: anywhere;
        word-break: break-word;
    }
    .rule-item p {
        margin: 4px 0;
        overflow-wrap: anywhere;
        word-break: break-word;
    }
    .node-list {
        margin: 4px 0 0 18px;
        padding: 0;
    }
    .node-list li {
        margin-bottom: 6px;
    }
    .node-list li p {
        margin: 2px 0;
        overflow-wrap: anywhere;
        word-break: break-word;
    }
    .target-list {
        margin: 4px 0 6px 0;
        padding: 0;
    }
    .selector-code {
        display: inline-block;
        padding: 2px 6px;
        border-radius: 4px;
        border: 1px solid #b9ad88;
        background-color: #efe9d3;
        font-family: "Consolas", "Courier New", monospace;
        font-size: 12px;
        overflow-wrap: anywhere;
        word-break: break-word;
    }
    .code-block {
        margin: 4px 0 6px;
        padding: 8px 10px;
        border: 1px solid #b9ad88;
        border-radius: 6px;
        background-color: #efe9d3;
        font-family: "Consolas", "Courier New", monospace;
        font-size: 12px;
        line-height: 1.35;
        white-space: pre-wrap;
        overflow-wrap: anywhere;
        word-break: break-word;
    }
    .code-block code {
        font-family: inherit;
    }
    .impact-pill {
        display: inline-block;
        border-radius: 999px;
        padding: 2px 8px;
        font-size: 12px;
        font-weight: 700;
        border: 1px solid transparent;
        text-transform: capitalize;
    }
    .impact-critical {
        color: #712d23;
        background-color: #f0cdc7;
        border-color: #c38a81;
    }
    .impact-serious {
        color: #7b4e18;
        background-color: #efd9bd;
        border-color: #cda370;
    }
    .impact-moderate {
        color: #665012;
        background-color: #eee2ba;
        border-color: #cdb56e;
    }
    .impact-minor {
        color: #355921;
        background-color: #d8e8c5;
        border-color: #96b37a;
    }
    .impact-undefined {
        color: #484233;
        background-color: #e2ddcd;
        border-color: #b4a98b;
    }
`;

export function reportHtmlBuilder(report: ReportData, meta: ReportMeta): string {
    return `
        <html>
            <head>
                <meta charset="UTF-8" />
                <title>Informe de accesibilidad</title>
                <style>${buildStyles()}</style>
            </head>
            <body>
                <main class="report-shell">
                    <header class="report-header">
                        <h1 class="page-title">Informe de accesibilidad</h1>
                        <p class="website-url"><strong>URL:</strong> <a href="${escapeHtml(report.url)}" target="_blank" rel="noopener noreferrer" class="summary-link">${escapeHtml(report.url)}</a></p>
                        <p class="timestamp"><strong>Fecha:</strong> ${escapeHtml(new Date(report.timestamp).toLocaleString('es-ES'))}</p>
                        <ul class="meta-list">
                            <li><strong>Cumplimiento legal:</strong> ${meta.compliance.legal.score === null ? 'n/d' : `${escapeHtml(meta.compliance.legal.score)}%`}</li>
                            <li><strong>Navegador:</strong> ${escapeHtml(meta.config.browser)}</li>
                            <li><strong>Pantalla:</strong> ${escapeHtml(screenLabel(meta))}</li>
                            <li><strong>Normas:</strong> ${escapeHtml(meta.config.tags.join(', '))}</li>
                            <li><strong>Ambito:</strong> ${meta.include ? `seccion <code>${escapeHtml(meta.include)}</code>` : 'pagina completa'}</li>
                            ${meta.exclude ? `<li><strong>Excluido:</strong> <code>${escapeHtml(meta.exclude)}</code></li>` : ''}
                        </ul>
                        ${meta.include ? '<p class="timestamp">Al analizar solo una seccion, axe omite las reglas de ambito de pagina (idioma del documento, landmarks, titulo).</p>' : ''}
                        ${meta.exclude ? `<p class="scope-warning"><strong>Contenido excluido:</strong> lo que casa con <code>${escapeHtml(meta.exclude)}</code> no se ha auditado y no aparece en este informe. Si es contenido propio y no de un tercero, forma parte del sitio, cuenta para el cumplimiento legal y hay que revisarlo por separado.</p>` : ''}
                    </header>

                    <h2 id="compliance" class="section-title">Cumplimiento</h2>
                    ${blockCompliance(meta.compliance)}

                    <h2 id="summary" class="section-title">Resumen</h2>
                    ${blockSummary(report)}
                    ${SECTIONS.filter(({ key }) => DETAILED_SECTIONS.includes(key)).map(({ key, label, detailsId }) => detailsSection(report, key, label, detailsId)).join('')}
                </main>
            </body>
        </html>
    `;
}