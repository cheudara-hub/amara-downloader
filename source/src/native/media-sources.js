const BUILTIN_SOURCES = [
  { id: 'hongguo', label: 'Hongguo' }, { id: 'xifan', label: 'Xifan' },
];

function getMediaSources(settings) {
  return [
    ...BUILTIN_SOURCES.filter(source => source.id === 'hongguo' || settings.builtin_sources?.[source.id] !== false),
    ...(settings.custom_sources || []).filter(source => source.enabled).map(source => ({ id: `custom:${source.id}`, label: source.name, custom: true })),
  ];
}

function setBuiltinSourceEnabled(settings, id, enabled) {
  if (id === 'hongguo') throw new Error('Hongguo source cannot be disabled');
  if (id !== 'xifan' || typeof enabled !== 'boolean') throw new Error('Invalid source toggle');
  return { ...settings, builtin_sources: { ...settings.builtin_sources, [id]: enabled } };
}

module.exports = { getMediaSources, setBuiltinSourceEnabled };
