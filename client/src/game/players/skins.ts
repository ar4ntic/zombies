import type { AnimationClip, Group } from "three";
import { clone as cloneSkinned } from "three/examples/jsm/utils/SkeletonUtils.js";
import { loadCharacter } from "../../engine/assets.ts";
import { loadManifest, measureGroundSpeed } from "../zombies/cast.ts";

export type PlayerClip = "idle" | "aim" | "walk" | "run" | "knockedOut" | "cheer";

export interface SkinTemplate {
  scene: Group;
  clips: Record<PlayerClip, AnimationClip>;
  /** Ground speed in m/s at which the walk and run clips play without foot sliding. */
  groundSpeed: { walk: number; run: number };
}

const templates = new Map<string, Promise<SkinTemplate>>();

/** Loads a player skin once; rejects when its model is missing or lacks a clip. */
export function loadSkin(id: string): Promise<SkinTemplate> {
  let template = templates.get(id);
  if (!template) {
    template = Promise.all([loadManifest(), loadCharacter(id)]).then(([manifest, gltf]) => {
      const clips = {} as Record<PlayerClip, AnimationClip>;
      for (const [key, clipName] of Object.entries(manifest.players.clips) as Array<[PlayerClip, string]>) {
        const clip = gltf.animations.find((c) => c.name === clipName);
        if (!clip) throw new Error(`${id}: missing clip ${clipName}`);
        clips[key] = clip;
      }
      const probe = cloneSkinned(gltf.scene);
      const groundSpeed = { walk: measureGroundSpeed(probe, clips.walk), run: measureGroundSpeed(probe, clips.run) };
      return { scene: gltf.scene, clips, groundSpeed };
    });
    templates.set(id, template);
  }
  return template;
}
