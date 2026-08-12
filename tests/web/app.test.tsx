import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { App } from '../../apps/web/src/App';

describe('App', () => {
  it('shows the project name', () => {
    render(<App />);

    expect(
      screen.getByRole('heading', { name: 'Elite Ticketing' }),
    ).toBeInTheDocument();
  });
});
