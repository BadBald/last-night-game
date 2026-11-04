import { EnemyClass } from '../types';

export interface EnemyArchetype {
  id: EnemyClass;
  name: string;
  maxHealth: number;
  radius: number;
  patrolSpeed: number;
  chaseSpeed: number;
  sightRange: number;
  sightHalfAngle: number; // radians
  hearingMultiplier: number;
  attackRange: number;
  attackDamage: number;
  attackCooldown: number;
  attackWindup: number;
  bleedChance: number;
  infectChance: number;
  sporeAuraRadius: number;
}

export const ENEMY_ARCHETYPES: Record<EnemyClass, EnemyArchetype> = {
  crawler: {
    id: 'crawler',
    name: 'Crawler',
    maxHealth: 48,
    radius: 12,
    patrolSpeed: 68,
    chaseSpeed: 192,
    sightRange: 255,
    sightHalfAngle: 1.05,
    hearingMultiplier: 1.15,
    attackRange: 30,
    attackDamage: 13,
    attackCooldown: 0.95,
    attackWindup: 0.3,
    bleedChance: 0.22,
    infectChance: 0.1,
    sporeAuraRadius: 0,
  },
  still: {
    id: 'still',
    name: 'Still',
    maxHealth: 78,
    radius: 13,
    patrolSpeed: 0, // Motionless ambusher
    chaseSpeed: 176,
    sightRange: 108, // Triggers only at close quarters or direct bright light/gunfire
    sightHalfAngle: Math.PI, // 360 proximity sense when disturbed
    hearingMultiplier: 0.42, // Ignores distant quiet sounds to maintain corpse disguise
    attackRange: 32,
    attackDamage: 22,
    attackCooldown: 1.25,
    attackWindup: 0.36,
    bleedChance: 0.25,
    infectChance: 0.28,
    sporeAuraRadius: 0,
  },
  bloom: {
    id: 'bloom',
    name: 'Bloom',
    maxHealth: 135,
    radius: 16,
    patrolSpeed: 42,
    chaseSpeed: 86,
    sightRange: 210,
    sightHalfAngle: 1.2,
    hearingMultiplier: 0.9,
    attackRange: 38,
    attackDamage: 17,
    attackCooldown: 1.5,
    attackWindup: 0.46,
    bleedChance: 0.08,
    infectChance: 0.35,
    sporeAuraRadius: 96, // Surrounded by infectious spore cloud
  },
  mimic: {
    id: 'mimic',
    name: 'Mimic',
    maxHealth: 112,
    radius: 14,
    patrolSpeed: 76,
    chaseSpeed: 184,
    sightRange: 300,
    sightHalfAngle: 1.15,
    hearingMultiplier: 1.35, // Acutely investigates sounds & emits false distress calls
    attackRange: 35,
    attackDamage: 25,
    attackCooldown: 1.1,
    attackWindup: 0.34,
    bleedChance: 0.34,
    infectChance: 0.2,
    sporeAuraRadius: 0,
  },
};
