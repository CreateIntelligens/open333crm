/**
 * Block-based JSON → MJML renderer (Task 2.1)
 * Converts an array of BlockNode objects to MJML markup.
 */

export type BlockType =
  | 'header'
  | 'text'
  | 'button'
  | 'image'
  | 'divider'
  | 'spacer';

export interface BlockNode {
  type: BlockType;
  content?: string;
  href?: string;
  src?: string;
  alt?: string;
  align?: 'left' | 'center' | 'right';
  color?: string;
  backgroundColor?: string;
  fontSize?: string;
  padding?: string;
  height?: string; // for spacer
}

/**
 * Renders a single block to an MJML section string.
 */
function renderBlock(block: BlockNode): string {
  const padding = block.padding ?? '10px 20px';

  switch (block.type) {
    case 'header':
      return `
  <mj-section background-color="${block.backgroundColor ?? '#f4f4f4'}">
    <mj-column>
      <mj-text font-size="${block.fontSize ?? '24px'}" color="${block.color ?? '#333333'}" align="${block.align ?? 'center'}" padding="${padding}" font-weight="bold">
        ${block.content ?? ''}
      </mj-text>
    </mj-column>
  </mj-section>`;

    case 'text':
      return `
  <mj-section>
    <mj-column>
      <mj-text font-size="${block.fontSize ?? '14px'}" color="${block.color ?? '#555555'}" align="${block.align ?? 'left'}" padding="${padding}">
        ${block.content ?? ''}
      </mj-text>
    </mj-column>
  </mj-section>`;

    case 'button':
      return `
  <mj-section>
    <mj-column>
      <mj-button background-color="${block.backgroundColor ?? '#6366f1'}" color="${block.color ?? '#ffffff'}" href="${block.href ?? '#'}" align="${block.align ?? 'center'}" padding="${padding}">
        ${block.content ?? 'Click Here'}
      </mj-button>
    </mj-column>
  </mj-section>`;

    case 'image':
      return `
  <mj-section>
    <mj-column>
      <mj-image src="${block.src ?? ''}" alt="${block.alt ?? ''}" align="${block.align ?? 'center'}" padding="${padding}" />
    </mj-column>
  </mj-section>`;

    case 'divider':
      return `
  <mj-section>
    <mj-column>
      <mj-divider border-color="${block.color ?? '#dddddd'}" padding="${padding}" />
    </mj-column>
  </mj-section>`;

    case 'spacer':
      return `
  <mj-section>
    <mj-column>
      <mj-spacer height="${block.height ?? '20px'}" />
    </mj-column>
  </mj-section>`;

    default:
      return '';
  }
}

/**
 * Converts an array of BlockNode objects to a full MJML document string.
 */
export function blockJsonToMjml(blocks: BlockNode[]): string {
  const sections = blocks.map(renderBlock).join('\n');

  return `<mjml>
  <mj-head>
    <mj-attributes>
      <mj-all font-family="Arial, sans-serif" />
    </mj-attributes>
  </mj-head>
  <mj-body>
${sections}
  </mj-body>
</mjml>`;
}

/**
 * Substitutes {{variable}} placeholders in MJML with values from the vars map.
 */
export function substituteMjmlVars(
  mjml: string,
  vars: Record<string, string>,
): string {
  return mjml.replace(/\{\{(\w+(?:\.\w+)*)\}\}/g, (_, key) => vars[key] ?? '');
}
