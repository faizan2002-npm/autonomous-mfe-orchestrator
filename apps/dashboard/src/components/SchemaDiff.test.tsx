import { render, screen } from '@testing-library/react';
import { buildRows, SchemaDiff } from './SchemaDiff';

const expectedSchema = ['id:number', 'firstName:string', 'profile.bio:string', 'meta:tag:string'];
const diff = {
  missingFields: ['firstName', 'profile.bio'],
  addedFields: ['first_name', 'bio'],
  typeMismatches: [{ path: 'id', expected: 'number', observed: 'string' }],
};

test('classifies every expected field and appends added ones', () => {
  expect(buildRows(expectedSchema, diff)).toEqual([
    { path: 'id', expected: 'number', observed: 'string', state: 'typeChanged' },
    { path: 'firstName', expected: 'string', state: 'missing' },
    { path: 'profile.bio', expected: 'string', state: 'missing' },
    { path: 'meta:tag', expected: 'string', observed: 'string', state: 'unchanged' },
    { path: 'first_name', state: 'added' },
    { path: 'bio', state: 'added' },
  ]);
});

test('renders change labels for reviewers', () => {
  render(<SchemaDiff expectedSchema={expectedSchema} diff={diff} />);
  expect(screen.getAllByText('missing')).toHaveLength(2);
  expect(screen.getAllByText('added')).toHaveLength(2);
  expect(screen.getByText('type changed')).toBeInTheDocument();
  expect(screen.getByText('firstName').closest('li')).toHaveAttribute('data-state', 'missing');
});
