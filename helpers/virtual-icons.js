'use strict';

const fs = require('fs/promises');
const path = require('path');

const directory = '/userdata/virtual-icons';
const elements = new Set(['svg', 'g', 'path', 'rect', 'circle', 'ellipse', 'line', 'polyline', 'polygon']);
const numberAttributes = new Set([
  'x', 'y', 'x1', 'y1', 'x2', 'y2', 'cx', 'cy', 'r', 'rx', 'ry', 'width', 'height',
  'stroke-width', 'stroke-miterlimit', 'stroke-dashoffset', 'opacity', 'fill-opacity', 'stroke-opacity',
]);
const colors = /^(none|currentColor|black|white|transparent|#[\da-f]{3,8})$/i;

function validateSvg(svg) {
  if (typeof svg !== 'string' || Buffer.byteLength(svg, 'utf8') > 256000) {
    throw new Error('The SVG must be text no larger than 256 KB.');
  }
  const { SaxesParser } = require('saxes'); // eslint-disable-line global-require
  const parser = new SaxesParser();
  let depth = 0;
  let root = false;
  parser.on('doctype', () => {
    throw new Error('SVG document types are not supported.');
  });
  parser.on('processinginstruction', () => {
    throw new Error('SVG processing instructions are not supported.');
  });
  parser.on('text', (text) => {
    if (text.trim()) throw new Error('SVG text elements are not supported.');
  });
  parser.on('opentag', (tag) => {
    if (!elements.has(tag.name) || (depth === 0 && (tag.name !== 'svg' || root))) {
      throw new Error(`Unsupported SVG element: ${tag.name}`);
    }
    if (depth === 0) root = true;
    depth += 1;
    Object.entries(tag.attributes).forEach(([name, value]) => {
      let valid = false;
      if (name === 'xmlns') valid = value === 'http://www.w3.org/2000/svg';
      else if (name === 'viewBox' || name === 'points' || name === 'stroke-dasharray') valid = /^[-+0-9eE.,\s]+$/.test(value);
      else if (numberAttributes.has(name)) valid = /^[-+0-9eE.%\s]+$/.test(value);
      else if (name === 'd') valid = /^[MmLlHhVvCcSsQqTtAaZz0-9eE+.,\s-]+$/.test(value);
      else if (name === 'fill' || name === 'stroke') valid = colors.test(value);
      else if (name === 'fill-rule' || name === 'clip-rule') valid = /^(nonzero|evenodd)$/.test(value);
      else if (name === 'stroke-linecap') valid = /^(butt|round|square)$/.test(value);
      else if (name === 'stroke-linejoin') valid = /^(miter|round|bevel)$/.test(value);
      else if (name === 'transform') valid = /^(?:(?:matrix|translate|scale|rotate|skewX|skewY)\s*\([-+0-9eE.,\s]+\)\s*)+$/.test(value);
      else if (name === 'version') valid = value === '1.1' || value === '1.0';
      if (!valid) throw new Error(`Unsupported SVG attribute: ${name}`);
    });
  });
  parser.on('closetag', () => {
    depth -= 1;
  });
  parser.write(svg).close();
  if (!root) throw new Error('The SVG has no root element.');
}

async function prepareIcon(input, id) {
  if (!input || input.type === 'default') return {};
  if (input.type === 'star') return { icon: '/star.svg' };
  if (input.type === 'circle') return { icon: '/circle.svg' };
  if (input.type !== 'upload') throw new Error('Select a valid icon.');
  validateSvg(input.svg);
  await fs.mkdir(directory, { recursive: true });
  await fs.writeFile(path.join(directory, `${id}.svg`), input.svg, { flag: 'wx' });
  return { icon: `/userdata/virtual-icons/${id}.svg`, iconId: id };
}

async function removeIcon(id) {
  if (typeof id !== 'string' || !/^[0-9a-f-]{36}$/.test(id)) return;
  try {
    await fs.unlink(path.join(directory, `${id}.svg`));
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
}

module.exports = { prepareIcon, removeIcon, validateSvg };
