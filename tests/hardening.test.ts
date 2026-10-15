import { describe, expect, it } from 'vitest';
import { injectPage } from '../src/seo/template.js';

describe('injectPage', () => {
  it('puts "$" sequences in names and headlines in as typed', () => {
    const shell = '<html><head><!--ssr-head--></head><body><div id="root"></div><!--ssr-body--></body></html>';
    const html = injectPage(shell, '<title>A$&B $1 $$</title>', '<p>Cost $& and $` and $\'</p>');
    expect(html).toContain('<title>A$&B $1 $$</title>');
    expect(html).toContain("<p>Cost $& and $` and $'</p>");
  });
  it('works without the markers too', () => {
    const html = injectPage('<html><head></head><body><div id="root"></div></body></html>', '<title>$1</title>', '<p>$&</p>');
    expect(html).toContain('<title>$1</title>');
    expect(html).toContain('<div id="root"></div>\n<p>$&</p>');
  });
});
