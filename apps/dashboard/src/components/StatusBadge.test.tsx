import { render, screen } from '@testing-library/react';
import { StatusBadge } from './StatusBadge';

test('humanizes values and labels FAILED patches as rejected', () => {
  render(
    <>
      <StatusBadge value="ROLLED_BACK" />
      <StatusBadge value="FAILED" />
      <StatusBadge value="HEALTHY" />
    </>,
  );
  expect(screen.getByText('Rolled Back')).toBeInTheDocument();
  expect(screen.getByText('Rejected')).toBeInTheDocument();
  expect(screen.getByText('Healthy').className).toMatch(/text-success/);
});
