'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { display } = require('../public/scripture-text');

test('renders alphabetic footnote markers as superscripts', () => {
  assert.equal(display('Opening [a], middle [b], ending [c].'), 'Opening ᵃ, middle ᵇ, ending ᶜ.');
});

test('renders numeric footnote markers and numeric ranges as superscripts', () => {
  assert.equal(display('Note [12], compare [1-3].'), 'Note ¹², compare ¹⁻³.');
});

test('does not alter ordinary bracketed text or unsupported groups', () => {
  assert.equal(display('Keep [note], [a, b] and [123x] unchanged.'), 'Keep [note], [a, b] and [123x] unchanged.');
});

test('keeps source text unchanged when producing a display string', () => {
  const source = 'The word [a] remains in the stored source.';
  const rendered = display(source);
  assert.equal(source, 'The word [a] remains in the stored source.');
  assert.equal(rendered, 'The word ᵃ remains in the stored source.');
});

test('handles null and non-string input safely', () => {
  assert.equal(display(null), '');
  assert.equal(display(123), '123');
});
