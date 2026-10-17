/**
 * H2 harness smoke — verifies that Vitest + Testing Library + jsdom are wired up.
 * Run: npm test -- harness-smoke
 */
import { render, screen } from '@testing-library/react';

describe('H2 frontend component harness smoke', () => {
  it('renders a React element in jsdom', () => {
    render(<p data-testid="smoke">Hello harness</p>);
    expect(screen.getByTestId('smoke')).toHaveTextContent('Hello harness');
  });

  it('@testing-library/jest-dom matchers work', () => {
    render(<button disabled>Save</button>);
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
  });
});
