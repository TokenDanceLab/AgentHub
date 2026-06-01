import React from 'react';
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { SearchInput } from './SearchInput';

describe('SearchInput', () => {
  it('renders with default placeholder "Search..."', () => {
    render(<SearchInput />);
    const input = screen.getByPlaceholderText('Search...');
    expect(input).toBeDefined();
    expect(input.getAttribute('type')).toBe('search');
  });

  it('accepts custom placeholder', () => {
    render(<SearchInput placeholder="Find files..." />);
    expect(screen.getByPlaceholderText('Find files...')).toBeDefined();
  });

  it('renders a search icon as label', () => {
    const { container } = render(<SearchInput />);
    // The label wraps an Icon component with name="search"
    const label = container.querySelector('label');
    expect(label).toBeDefined();
    expect(screen.getByText('search')).toBeDefined();
  });

  it('forwards id to the input element', () => {
    render(<SearchInput id="file-search" />);
    const input = screen.getByPlaceholderText('Search...');
    expect(input.getAttribute('id')).toBe('file-search');
  });

  it('uses default id "search-input" when no id provided', () => {
    render(<SearchInput />);
    const input = screen.getByPlaceholderText('Search...');
    expect(input.getAttribute('id')).toBe('search-input');
  });

  it('label htmlFor references the input id', () => {
    render(<SearchInput id="custom-id" />);
    const label = document.querySelector('label');
    expect(label?.getAttribute('for')).toBe('custom-id');
  });

  it('applies className to the input element', () => {
    render(<SearchInput className="my-search" />);
    const input = screen.getByPlaceholderText('Search...');
    expect(input.className).toContain('my-search');
  });

  it('forwards additional HTML input attributes', () => {
    render(<SearchInput disabled={true} aria-label="Search field" data-testid="search-field" />);
    const input = screen.getByPlaceholderText('Search...');
    expect(input.hasAttribute('disabled')).toBe(true);
    expect(input.getAttribute('aria-label')).toBe('Search field');
    expect(input.getAttribute('data-testid')).toBe('search-field');
  });

  it('accepts onChange handler', () => {
    const { container } = render(<SearchInput onChange={() => {}} />);
    // Just verifying the input is still rendered with the handler
    const input = container.querySelector('input');
    expect(input).toBeDefined();
  });
});
