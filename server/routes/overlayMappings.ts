import {
  getDefaultMappings,
  hasDefaultMappings,
} from '@server/lib/overlays/DefaultMappingsService';
import {
  getMergedMappings,
  hasUserMappings,
  resetFieldMappings,
  saveFieldMappings,
} from '@server/lib/overlays/UserMappingsService';
import { Router } from 'express';

const router = Router();

/**
 * GET /api/v1/overlay-mappings/:field
 * Get merged mappings (defaults + user overrides) for a specific field
 */
router.get('/:field', (req, res) => {
  const { field } = req.params;

  const mappings = getMergedMappings(field);
  const hasDefaults = hasDefaultMappings(field);
  const hasCustom = hasUserMappings(field);

  res.json({
    field,
    mappings,
    hasDefaults,
    hasCustomMappings: hasCustom,
    isUsingDefaults: hasDefaults && !hasCustom,
  });
});

/**
 * PUT /api/v1/overlay-mappings/:field
 * Save user mappings for a specific field
 */
router.put('/:field', (req, res) => {
  const { field } = req.params;
  const { mappings } = req.body;

  if (!Array.isArray(mappings)) {
    return res.status(400).json({ error: 'mappings must be an array' });
  }

  // Validate each mapping has required fields
  for (const mapping of mappings) {
    if (
      typeof mapping.value !== 'string' ||
      typeof mapping.iconPath !== 'string'
    ) {
      return res.status(400).json({
        error: 'Each mapping must have value and iconPath as strings',
      });
    }
  }

  saveFieldMappings(field, mappings);

  res.json({
    success: true,
    field,
    mappingCount: mappings.length,
  });
});

/**
 * DELETE /api/v1/overlay-mappings/:field
 * Reset mappings for a field back to defaults
 */
router.delete('/:field', (req, res) => {
  const { field } = req.params;

  resetFieldMappings(field);

  // Return the default mappings after reset
  const defaultMappings = getDefaultMappings(field);

  res.json({
    success: true,
    field,
    mappings: defaultMappings,
    isUsingDefaults: true,
  });
});

export default router;
