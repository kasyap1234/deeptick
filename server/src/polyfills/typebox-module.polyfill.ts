import { t } from 'elysia';

type TypeBoxModule = {
  $defs: Record<string, unknown>;
  Import: (name: string) => unknown;
};

type TypeWithModule = typeof t & {
  Module?: (definitions: Record<string, unknown>) => TypeBoxModule;
};

const typeWithModule = t as TypeWithModule;

if (typeof typeWithModule.Module !== 'function') {
  typeWithModule.Module = (definitions: Record<string, unknown>) => ({
    $defs: definitions,
    Import: (name: string) => definitions[name],
  });
}
