import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';

// Testing Library only registers its own cleanup automatically when Vitest
// runs with `globals: true`. This project does not, so without this hook every
// rendered tree stays in the document and queries begin failing with
// "Found multiple elements" as soon as a file has more than one render.
afterEach(cleanup);
