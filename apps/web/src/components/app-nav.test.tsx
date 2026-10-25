import { cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { AppNav } from './app-nav';

afterEach(cleanup);

describe('AppNav', () => {
  it('links to the four apps', () => {
    render(<AppNav />);
    const links = within(screen.getByRole('navigation', { name: 'Apps' })).getAllByRole('link');
    expect(links.map((a) => a.getAttribute('href'))).toEqual(['/stage', '/console', '/aero', '/assistant']);
    expect(screen.getByText('Halyn Stage')).toBeTruthy();
  });
});
