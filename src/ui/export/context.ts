// The data every export is built from: the project and analysis after the
// signed-layer exclusion, the map settings that apply to them, and the names
// layer under the anonymisation setting. Building this is the one place both
// settings are applied, so no export can skip either (spec §11).

import type { Project } from '../../data/schema';
import type { AnalysisInput, AnalysisResult } from '../engineClient';
import { buildAnalysisInput } from '../engineClient';
import { effectiveSettings } from '../map/useMapModel';
import { memberNames, type MemberNames } from '../state/names';
import { effectiveWeights, type WeightState } from '../state/presets';
import type { MapSettings } from '../state/store';
import { exclusionApplies, exportProject } from './scope';

/** Runs one analysis; the browser uses a worker of its own, tests call the engine directly. */
export type Analyse = (input: AnalysisInput) => Promise<AnalysisResult>;

export interface ExportRequest {
  /** The open project. */
  project: Project;
  /** The analysis on screen. */
  result: AnalysisResult;
  map: MapSettings;
  weights: WeightState;
  anonymise: boolean;
  excludeSigned: boolean;
}

export interface ExportContext {
  /** The open project, for figures the exclusion does not touch (survey response rates). */
  source: Project;
  /** The project the export shows: without the excluded layers when the exclusion applies. */
  project: Project;
  result: AnalysisResult;
  /** Map settings corrected for the export's analysis. */
  settings: MapSettings;
  names: MemberNames;
  anonymised: boolean;
  /** The exclusion is on (whether or not the project has layers it removes). */
  excludeSigned: boolean;
  /** The exclusion removed at least one enabled layer, so the analysis was run again. */
  reanalysed: boolean;
  weights: ReturnType<typeof effectiveWeights>;
  weightsPreset: WeightState['preset'];
}

export async function exportContext(
  request: ExportRequest,
  analyse: Analyse,
): Promise<ExportContext> {
  const { project: source, anonymise, excludeSigned } = request;
  const reanalysed = exclusionApplies(source, excludeSigned);
  const project = exportProject(source, excludeSigned);
  const weights = effectiveWeights(project, request.weights);
  let result = request.result;
  let map = request.map;
  if (reanalysed) {
    const input = buildAnalysisInput(
      project,
      {
        view: map.view,
        symmetrise: map.symmetrise,
        weights: weights.weights,
        signedTreatment: weights.signedTreatment,
      },
      `export:${request.result.inputKey}`,
    );
    result = await analyse(input);
    // A highlight may come from an insight on a removed layer (negative
    // clusters), so the members it names could reveal signed ratings.
    map = { ...map, highlight: [] };
  }
  return {
    source,
    project,
    result,
    settings: effectiveSettings(project, result, map),
    // Codes and names depend only on the members, which the exclusion keeps.
    names: memberNames(source, anonymise),
    anonymised: anonymise,
    excludeSigned,
    reanalysed,
    weights,
    weightsPreset: request.weights.preset,
  };
}
