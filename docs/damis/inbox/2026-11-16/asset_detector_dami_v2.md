# DAMI: `asset_detector` (v2) → output_21

**Stage:** 2 Script, runs right after the user accepts the script
**Job:** Reads ONE accepted script and returns output_21: every character, location and prop as a deduplicated asset entry with evidence and scene references, plus a scene index that maps each scene to its assets and records who speaks in it. It extracts and never designs.
**Consumers:** Character Generator v5, Location Generator v1, Prop Generator v1, Text Blocks (and output_22 if it runs after this dami), Pre-production category screens (char, loc, prop).
**Companion file:** `asset_detector_review_catalog_v1.json`
**Model:** `claude-sonnet-5-5`, temperature 0, max_tokens 32000, tool `submit_output_21` forced with `tool_choice: {"type": "tool", "name": "submit_output_21"}`, no extended thinking (forced tool choice does not combine with it; the scene-index-first field order does the step-by-step work instead).

---

## 0. Decisions made in this chat

1. **Extract, never design.** Every fact, look, state and fixed element carries a verbatim script excerpt (max 20 words) that the backend verifies. Visual gaps stay empty for the generators.
2. **Scene index first.** The tool schema starts with `scene_index`, so the model walks the script scene by scene before aggregating. Asset `scene_refs` and the index must agree (validator).
3. **Ids:** `char_1`, `loc_1`, `prop_1`, numbered by first appearance, never reused. Scene numbers are strings ("12A" allowed).
4. **Characters:** one entry per individual; aliases merged. Different age or physical form = separate entry linked with `same_person_as`. Costume, injury, disguise = `looks` on the same entry. Uncertain merges stay separate with `MERGE_CHECK:`. Crowds = one `background_group` entry. Unseen speakers = `voice_only`.
5. **Locations:** one entry per space; rooms of one place share `location_group`; INT and EXT are separate entries. Time of day and conditions are `states` on one entry (matches the registry: variants are mutable elements). Car interior = location, car exterior = prop, linked.
6. **Props:** five-part inclusion test (handled, plot, continuity, specific description, shown vehicle). Fixtures nobody touches go to the location's `fixed_elements_from_script`, so the Location Generator designs them and `exclude_assets` stays clean. `category_hint` uses the Prop Generator's families.
7. **Voices (v2):** voices are NOT assets in Pre-production. They are added in Production, block by block: when a text block contains dialogue, the UI opens a box where the user uploads the voice, generates it there, or lets the video model create it. The detector only prepares the data for that: each scene's `speakers` and `heard_only`, and per character `speaks`, `dialogue_line_count`, `dialogue_language`, `voice_delivery` and `voice_hints` (stated voice facts with evidence). There is no `voices[]` array and no `voice_` id.
8. **Priority:** `required` / `optional` from the dami; the backend adds `skipped` (ADP01). The wizard shows required first and lets the user skip optional ones.
9. **Language:** `name` as written in the script, `name_latin` for prompts and file names, all model-facing text in English, `ui_summary` in `project.ui_language`, evidence in the original language.
10. **Modes:** `full`, `incremental` (series episodes and edited scripts, with `known_assets`, approved assets never renamed or deleted) and `fix` (catalog codes).
11. **Review:** no separate approval screen. Corrections start from the Pre-production category screens (see section 7).

---

## 1. Where it runs

```
Script accepted
  └─ asset_detector (mode full)  → output_21 stored
        ├─ Pre-production category screens open from output_21
        └─ output_22 dami (recommended: started after output_21 so its prompts can use asset ids)
Series: one call per episode, mode incremental, known_assets = all assets of earlier episodes.
Script edited later: mode incremental with known_assets = current output_21.
```

---

## 2. Input contract

| Field | Required | Notes |
|---|---|---|
| `mode` | yes | `full`, `incremental`, `fix` |
| `project.format` | yes | `movie` or `series` |
| `project.episode_number` | series | |
| `project.genre`, `project.style`, `project.era_setting` | yes | relevance only, never change detection |
| `project.ui_language` | yes | language of `ui_summary` (e.g. `fa`, `en`) |
| `project.sector` | yes | `wizard` or `pro` |
| `script.title`, `script.logline`, `script.source` | yes | `source`: `generated` or `uploaded` |
| `script.scenes[]` | preferred | `scene_number`, `heading`, `text`, optional `purpose`, `change` (Script Writer hidden fields) |
| `script.raw_text` | fallback | when scenes are not split; the dami splits and returns `anchor` per scene |
| `known_assets` | incremental, fix | earlier entries with `status`: `detected`, `in_progress`, `approved` |
| `previous_output`, `fix_requests` | fix | `fix_requests[]`: `type`, `code`, `instruction`, `target_ids`, `custom_text` |

---

## 3. Output contract (output_21)

Authoritative shape: the tool schema in section 4. Fields the downstream contracts require:

| Consumer | Needs | Provided by |
|---|---|---|
| Location Generator | `name`, `interior_exterior`, `time_of_day`, `script_description`, `scene_refs` | `locations[]` (plus `states`, `fixed_elements_from_script`, `location_group`) |
| Prop Generator | `name`, `script_description`, `scene_refs`, `category_hint`, `users`, `location_ids` | `props[]` (plus `states`, `text_on_object`, `subtype`) |
| Character Generator | character details | `characters[]`: `facts`, `looks`, `script_description`, `is_minor`, `relationships` |
| Location Generator `script_context` | scenes with `characters_present` | `scene_index[]` |
| Location Generator `exclude_assets` | names of chars and props | `characters[].name_latin` + `props[].name_latin` |
| Text Blocks | asset per scene, and whether a block has dialogue | `scene_index[]` (`speakers`, `heard_only`) |
| Production voice box | who speaks, language, stated voice traits | `characters[]`: `speaks`, `dialogue_language`, `voice_delivery`, `voice_hints` |

Each `facts[]` item: `field`, `value`, `status` (`stated` | `implied`), `scene`, `evidence`.

---

## 4. Tool schema (`submit_output_21`)

```json
{
  "name": "submit_output_21",
  "description": "Submit the complete asset inventory (output_21) for the script. Call exactly once.",
  "input_schema": {
    "type": "object",
    "required": [
      "output_version",
      "mode",
      "scene_index",
      "characters",
      "locations",
      "props",
      "diff",
      "summary",
      "applied_fixes",
      "assumptions",
      "warnings"
    ],
    "additionalProperties": false,
    "properties": {
      "output_version": {
        "const": "output_21"
      },
      "mode": {
        "enum": [
          "full",
          "incremental",
          "fix"
        ]
      },
      "scene_index": {
        "type": "array",
        "items": {
          "type": "object",
          "required": [
            "scene_number",
            "heading",
            "anchor",
            "location_id",
            "location_state_id",
            "time_of_day",
            "characters_present",
            "char_looks",
            "heard_only",
            "speakers",
            "props_present"
          ],
          "additionalProperties": false,
          "properties": {
            "scene_number": {
              "type": "string"
            },
            "heading": {
              "type": "string"
            },
            "anchor": {
              "type": [
                "string",
                "null"
              ]
            },
            "location_id": {
              "type": [
                "string",
                "null"
              ]
            },
            "location_state_id": {
              "type": [
                "string",
                "null"
              ]
            },
            "time_of_day": {
              "enum": [
                "dawn",
                "morning",
                "day",
                "afternoon",
                "dusk",
                "evening",
                "night",
                "unspecified"
              ]
            },
            "characters_present": {
              "type": "array",
              "items": {
                "type": "string"
              }
            },
            "char_looks": {
              "type": "array",
              "items": {
                "type": "object",
                "required": [
                  "char_id",
                  "look_id"
                ],
                "additionalProperties": false,
                "properties": {
                  "char_id": {
                    "type": "string"
                  },
                  "look_id": {
                    "type": "string"
                  }
                }
              }
            },
            "heard_only": {
              "type": "array",
              "items": {
                "type": "string"
              }
            },
            "speakers": {
              "type": "array",
              "items": {
                "type": "string"
              }
            },
            "props_present": {
              "type": "array",
              "items": {
                "type": "string"
              }
            }
          }
        }
      },
      "characters": {
        "type": "array",
        "items": {
          "type": "object",
          "required": [
            "char_id",
            "name",
            "name_latin",
            "aliases",
            "kind",
            "role",
            "asset_priority",
            "needs_visual",
            "is_minor",
            "same_person_as",
            "script_description",
            "facts",
            "looks",
            "signature_prop_ids",
            "speaks",
            "dialogue_line_count",
            "dialogue_language",
            "voice_delivery",
            "voice_hints",
            "relationships",
            "scene_refs",
            "first_scene",
            "ui_summary"
          ],
          "additionalProperties": false,
          "properties": {
            "char_id": {
              "type": "string",
              "pattern": "^char_[0-9]+$"
            },
            "name": {
              "type": "string"
            },
            "name_latin": {
              "type": "string"
            },
            "aliases": {
              "type": "array",
              "items": {
                "type": "string"
              }
            },
            "kind": {
              "enum": [
                "human",
                "animal",
                "creature",
                "robot",
                "voice_only",
                "background_group"
              ]
            },
            "role": {
              "enum": [
                "lead",
                "supporting",
                "minor",
                "background"
              ]
            },
            "asset_priority": {
              "enum": [
                "required",
                "optional"
              ]
            },
            "needs_visual": {
              "type": "boolean"
            },
            "is_minor": {
              "enum": [
                "yes",
                "no",
                "unknown"
              ]
            },
            "same_person_as": {
              "type": [
                "string",
                "null"
              ]
            },
            "script_description": {
              "type": "string"
            },
            "facts": {
              "type": "array",
              "items": {
                "type": "object",
                "required": [
                  "field",
                  "value",
                  "status",
                  "scene",
                  "evidence"
                ],
                "additionalProperties": false,
                "properties": {
                  "field": {
                    "type": "string"
                  },
                  "value": {
                    "type": "string"
                  },
                  "status": {
                    "enum": [
                      "stated",
                      "implied"
                    ]
                  },
                  "scene": {
                    "type": "string"
                  },
                  "evidence": {
                    "type": "string",
                    "description": "Exact excerpt from the script, max 20 words, copied character for character."
                  }
                }
              }
            },
            "looks": {
              "type": "array",
              "items": {
                "type": "object",
                "required": [
                  "look_id",
                  "description",
                  "scene_refs",
                  "evidence"
                ],
                "additionalProperties": false,
                "properties": {
                  "look_id": {
                    "type": "string"
                  },
                  "description": {
                    "type": "string"
                  },
                  "scene_refs": {
                    "type": "array",
                    "items": {
                      "type": "string"
                    }
                  },
                  "evidence": {
                    "type": "string"
                  }
                }
              }
            },
            "signature_prop_ids": {
              "type": "array",
              "items": {
                "type": "string"
              }
            },
            "speaks": {
              "type": "boolean"
            },
            "dialogue_line_count": {
              "type": "integer",
              "minimum": 0
            },
            "dialogue_language": {
              "type": [
                "string",
                "null"
              ]
            },
            "voice_delivery": {
              "type": "array",
              "items": {
                "enum": [
                  "on_screen",
                  "voice_over",
                  "off_screen",
                  "phone_or_device",
                  "whisper",
                  "singing",
                  "other"
                ]
              }
            },
            "voice_hints": {
              "type": "array",
              "items": {
                "type": "object",
                "required": [
                  "field",
                  "value",
                  "status",
                  "scene",
                  "evidence"
                ],
                "additionalProperties": false,
                "properties": {
                  "field": {
                    "type": "string"
                  },
                  "value": {
                    "type": "string"
                  },
                  "status": {
                    "enum": [
                      "stated",
                      "implied"
                    ]
                  },
                  "scene": {
                    "type": "string"
                  },
                  "evidence": {
                    "type": "string",
                    "description": "Exact excerpt from the script, max 20 words, copied character for character."
                  }
                }
              }
            },
            "relationships": {
              "type": "array",
              "items": {
                "type": "object",
                "required": [
                  "char_id",
                  "relation"
                ],
                "additionalProperties": false,
                "properties": {
                  "char_id": {
                    "type": "string"
                  },
                  "relation": {
                    "type": "string"
                  }
                }
              }
            },
            "scene_refs": {
              "type": "array",
              "items": {
                "type": "string"
              }
            },
            "first_scene": {
              "type": "string"
            },
            "ui_summary": {
              "type": "string"
            }
          }
        }
      },
      "locations": {
        "type": "array",
        "items": {
          "type": "object",
          "required": [
            "loc_id",
            "name",
            "name_latin",
            "aliases",
            "location_group",
            "interior_exterior",
            "time_of_day",
            "times_of_day",
            "states",
            "script_description",
            "facts",
            "fixed_elements_from_script",
            "related_asset_ids",
            "asset_priority",
            "scene_refs",
            "first_scene",
            "ui_summary"
          ],
          "additionalProperties": false,
          "properties": {
            "loc_id": {
              "type": "string",
              "pattern": "^loc_[0-9]+$"
            },
            "name": {
              "type": "string"
            },
            "name_latin": {
              "type": "string"
            },
            "aliases": {
              "type": "array",
              "items": {
                "type": "string"
              }
            },
            "location_group": {
              "type": [
                "string",
                "null"
              ]
            },
            "interior_exterior": {
              "enum": [
                "interior",
                "exterior",
                "int_ext"
              ]
            },
            "time_of_day": {
              "enum": [
                "dawn",
                "morning",
                "day",
                "afternoon",
                "dusk",
                "evening",
                "night",
                "unspecified"
              ]
            },
            "times_of_day": {
              "type": "array",
              "items": {
                "enum": [
                  "dawn",
                  "morning",
                  "day",
                  "afternoon",
                  "dusk",
                  "evening",
                  "night",
                  "unspecified"
                ]
              }
            },
            "states": {
              "type": "array",
              "items": {
                "type": "object",
                "required": [
                  "state_id",
                  "description",
                  "scene_refs",
                  "evidence"
                ],
                "additionalProperties": false,
                "properties": {
                  "state_id": {
                    "type": "string"
                  },
                  "description": {
                    "type": "string"
                  },
                  "scene_refs": {
                    "type": "array",
                    "items": {
                      "type": "string"
                    }
                  },
                  "evidence": {
                    "type": "string"
                  }
                }
              }
            },
            "script_description": {
              "type": "string"
            },
            "facts": {
              "type": "array",
              "items": {
                "type": "object",
                "required": [
                  "field",
                  "value",
                  "status",
                  "scene",
                  "evidence"
                ],
                "additionalProperties": false,
                "properties": {
                  "field": {
                    "type": "string"
                  },
                  "value": {
                    "type": "string"
                  },
                  "status": {
                    "enum": [
                      "stated",
                      "implied"
                    ]
                  },
                  "scene": {
                    "type": "string"
                  },
                  "evidence": {
                    "type": "string",
                    "description": "Exact excerpt from the script, max 20 words, copied character for character."
                  }
                }
              }
            },
            "fixed_elements_from_script": {
              "type": "array",
              "items": {
                "type": "object",
                "required": [
                  "element",
                  "scene",
                  "evidence"
                ],
                "additionalProperties": false,
                "properties": {
                  "element": {
                    "type": "string"
                  },
                  "scene": {
                    "type": "string"
                  },
                  "evidence": {
                    "type": "string"
                  }
                }
              }
            },
            "related_asset_ids": {
              "type": "array",
              "items": {
                "type": "string"
              }
            },
            "asset_priority": {
              "enum": [
                "required",
                "optional"
              ]
            },
            "scene_refs": {
              "type": "array",
              "items": {
                "type": "string"
              }
            },
            "first_scene": {
              "type": "string"
            },
            "ui_summary": {
              "type": "string"
            }
          }
        }
      },
      "props": {
        "type": "array",
        "items": {
          "type": "object",
          "required": [
            "prop_id",
            "name",
            "name_latin",
            "aliases",
            "category_hint",
            "subtype",
            "script_description",
            "facts",
            "states",
            "text_on_object",
            "users",
            "location_ids",
            "related_asset_ids",
            "asset_priority",
            "scene_refs",
            "first_scene",
            "ui_summary"
          ],
          "additionalProperties": false,
          "properties": {
            "prop_id": {
              "type": "string",
              "pattern": "^prop_[0-9]+$"
            },
            "name": {
              "type": "string"
            },
            "name_latin": {
              "type": "string"
            },
            "aliases": {
              "type": "array",
              "items": {
                "type": "string"
              }
            },
            "category_hint": {
              "enum": [
                "hero_prop",
                "hand_prop",
                "functional_prop",
                "set_dressing",
                "prop_group"
              ]
            },
            "subtype": {
              "type": [
                "string",
                "null"
              ]
            },
            "script_description": {
              "type": "string"
            },
            "facts": {
              "type": "array",
              "items": {
                "type": "object",
                "required": [
                  "field",
                  "value",
                  "status",
                  "scene",
                  "evidence"
                ],
                "additionalProperties": false,
                "properties": {
                  "field": {
                    "type": "string"
                  },
                  "value": {
                    "type": "string"
                  },
                  "status": {
                    "enum": [
                      "stated",
                      "implied"
                    ]
                  },
                  "scene": {
                    "type": "string"
                  },
                  "evidence": {
                    "type": "string",
                    "description": "Exact excerpt from the script, max 20 words, copied character for character."
                  }
                }
              }
            },
            "states": {
              "type": "array",
              "items": {
                "type": "object",
                "required": [
                  "state_id",
                  "description",
                  "scene_refs",
                  "evidence"
                ],
                "additionalProperties": false,
                "properties": {
                  "state_id": {
                    "type": "string"
                  },
                  "description": {
                    "type": "string"
                  },
                  "scene_refs": {
                    "type": "array",
                    "items": {
                      "type": "string"
                    }
                  },
                  "evidence": {
                    "type": "string"
                  }
                }
              }
            },
            "text_on_object": {
              "type": "array",
              "items": {
                "type": "object",
                "required": [
                  "text",
                  "evidence"
                ],
                "additionalProperties": false,
                "properties": {
                  "text": {
                    "type": "string"
                  },
                  "evidence": {
                    "type": "string"
                  }
                }
              }
            },
            "users": {
              "type": "array",
              "items": {
                "type": "string"
              }
            },
            "location_ids": {
              "type": "array",
              "items": {
                "type": "string"
              }
            },
            "related_asset_ids": {
              "type": "array",
              "items": {
                "type": "string"
              }
            },
            "asset_priority": {
              "enum": [
                "required",
                "optional"
              ]
            },
            "scene_refs": {
              "type": "array",
              "items": {
                "type": "string"
              }
            },
            "first_scene": {
              "type": "string"
            },
            "ui_summary": {
              "type": "string"
            }
          }
        }
      },
      "diff": {
        "type": "object",
        "required": [
          "added",
          "updated",
          "removed"
        ],
        "additionalProperties": false,
        "properties": {
          "added": {
            "type": "array",
            "items": {
              "type": "string"
            }
          },
          "updated": {
            "type": "array",
            "items": {
              "type": "string"
            }
          },
          "removed": {
            "type": "array",
            "items": {
              "type": "string"
            }
          }
        }
      },
      "summary": {
        "type": "object",
        "additionalProperties": false,
        "required": [
          "scene_count",
          "character_count",
          "location_count",
          "prop_count"
        ],
        "properties": {
          "scene_count": {
            "type": "integer",
            "minimum": 0
          },
          "character_count": {
            "type": "integer",
            "minimum": 0
          },
          "location_count": {
            "type": "integer",
            "minimum": 0
          },
          "prop_count": {
            "type": "integer",
            "minimum": 0
          }
        }
      },
      "applied_fixes": {
        "type": "array",
        "items": {
          "type": "object",
          "required": [
            "code",
            "target_ids",
            "change"
          ],
          "additionalProperties": false,
          "properties": {
            "code": {
              "type": "string"
            },
            "target_ids": {
              "type": "array",
              "items": {
                "type": "string"
              }
            },
            "change": {
              "type": "string"
            }
          }
        }
      },
      "assumptions": {
        "type": "array",
        "items": {
          "type": "string"
        }
      },
      "warnings": {
        "type": "array",
        "items": {
          "type": "string"
        }
      }
    }
  }
}
```

---

## 5. System prompt

```
# ROLE
You are the Asset Detector Dami inside BLAXZY, an AI visual generation platform for films and series. Your single job: read ONE accepted script and produce output_21, the complete and deduplicated inventory of every asset that must exist before production: characters, locations and props, plus a scene index that maps every scene to the assets in it and records who speaks in it. Voices are not assets at this stage: they are added later, in Production, block by block. You only record who speaks, where, and what the script says about their voice.

Your output is parsed by code and fed to later automated steps: the Character, Location and Prop Generators design each asset from your entries, and the Text Blocks dami uses your scene index to attach assets to shots and to know which blocks contain dialogue. A missed asset, a duplicate or an invented detail breaks those steps. You never chat, never explain and never ask questions. You return your result only by calling the submit_output_21 tool, exactly once.

# CORE PRINCIPLE: EXTRACT, NEVER DESIGN
You report what the script contains. Designing is the job of later dami.
- Every fact you record must be traceable to the script text through an evidence excerpt.
- Never add plot, characters, places or objects that the script does not contain.
- Never fill visual gaps with your own taste (no colors, materials, faces or styles the script does not state or clearly imply). Missing details stay missing; the generators fill them later.
- "Implied" is allowed only when a specific cue in the text makes the fact near-certain (a "police officer" on duty implies a uniform; "her grandson, a toddler" implies a minor). The cue is the evidence.
- The project style and genre never change what you detect. They are given only so you can judge relevance.

# INPUT
A JSON object inside <input> tags:
- mode: "full" (first detection), "incremental" (new episode or edited script, with known_assets) or "fix" (correction round, with previous_output and fix_requests)
- project: format ("movie" | "series"), episode_number (series only), genre, style, era_setting, ui_language, sector ("wizard" | "pro")
- script: title, logline, source ("generated" | "uploaded"), and EITHER scenes[] (each: scene_number, heading, text, optional purpose, optional change) OR raw_text
- known_assets (incremental and fix): earlier output_21 entries, each with its id and a status ("detected" | "in_progress" | "approved")
- previous_output (fix only): the output_21 being corrected
- fix_requests (fix only): [{type, code, instruction, target_ids, custom_text}]

# WORK ORDER
Work in this order, because the tool fields are filled in this order and later fields depend on earlier ones.

## STEP 1: SCENE INDEX (fill scene_index first)
- If script.scenes is given, use its scene_number values exactly as given (they may be strings such as "12A"). Set anchor to null.
- If only raw_text is given, split it into scenes: a new scene starts at each scene heading, or, when there are no headings, at each clear change of place or a jump in time. Number them "1", "2", "3" in order. Set heading to the heading line, or to a short English label in the form "INT./EXT. PLACE - TIME" when there is none. Set anchor to the first 6 to 12 words of the scene, copied exactly, so the backend can find where the scene starts.
- Go through the scenes one by one, in order. For each scene record: the location, the time of day, every character physically present on screen, every character heard but not seen (voice-over, phone, off-screen), every character who speaks at least one line in the scene (seen or not), every prop asset present, and any non-default character look or location state used in it.
- Assign ids at first appearance: char_1, char_2 ...; loc_1 ...; prop_1 ... (no leading zeros). In incremental and fix mode, reuse the ids of known_assets and continue numbering after the highest existing id of each type. Never reuse a removed id for a different asset.
- A scene with no stated or inferable place gets location_id null and a warning "NO_LOCATION: scene <n> ...". If a scene clearly continues the previous one without a change of place, reuse that location and log it in assumptions.

## STEP 2: CHARACTERS
What counts as a character: every being on screen or heard who has agency in the story, whether named ("SARA") or only specified ("the old fisherman", "a nervous clerk"). This includes animals, creatures and robots that act. It does not include a person who is only talked about and never appears or speaks.

Identity resolution (the most important rule in this step):
- The same individual under different labels (SARA, MRS. KARIMI, MOM, "the woman in red" later revealed as Sara) is ONE entry. The most used label is the name; all others go into aliases.
- When you are not sure two labels are the same individual, keep them separate, add a warning "MERGE_CHECK: char_x and char_y may be the same person (reason)" and do not link them.
- Twins, doubles and look-alikes are separate entries.
- The same person at clearly different ages or in a different physical form (young Ali, 8, in a flashback and Ali, 40; a human who becomes a wolf) gets separate entries, linked with same_person_as pointing to the first entry. Each needs its own design.
- Changes of clothing, injuries, dirt, haircuts and disguises are NOT new characters. Record them as looks on the same entry, each with its scene_refs and evidence. The default look is not listed as a look; it is described in facts and script_description.

Fields:
- kind: human, animal, creature, robot, voice_only (heard but never seen, such as a narrator or a voice on the phone that never appears; needs_visual false, so no image is designed for it in Pre-production), background_group (a crowd or group the script asks to see, such as "the crowded bazaar", "five soldiers"; one entry per group, not per person).
- role: lead (central, in most scenes), supporting (recurring, with real lines or actions), minor (one or two scenes with a line or a specific action), background (no lines, no individual action).
- asset_priority: required for every character with dialogue, with two or more scenes, or with a specified look; optional for background roles and background_group entries.
- is_minor: "yes" if any cue puts the character under 18, "no" if an age or cue puts them at 18 or over, otherwise "unknown". If any character is "yes", add the warning "MINOR_PRESENT: char_x" so downstream dami keep depictions age-appropriate.
- facts: gender, age (exact if stated, otherwise a range as implied), species if not human, ethnicity or nationality ONLY if stated, height, build, hair, face (marks, scars, glasses, beard), skin, default wardrobe, distinctive accessories, physical condition, demeanor as shown in action. One fact per field; repeat a field only when the script gives several distinct details.
- signature_prop_ids: props that identify the character (a cane always carried).
- speaks and dialogue_line_count: count the dialogue blocks the character speaks, including voice-over.
- dialogue_language: the language the character speaks (the dialogue language, or as stated); null if the character never speaks.
- voice_delivery: every way the character's voice is heard (on_screen, voice_over, off_screen, phone_or_device, whisper, singing, other); empty if the character never speaks.
- voice_hints: only voice facts the script states or clearly implies (accent, pitch, rasp, stutter, age of the voice, emotional register), each with evidence. Never describe the voice from the character's look. These are used later, in Production, when the voice is uploaded or generated.
- relationships: only relations the script states or clearly shows (mother of, partner of, boss of), using the other character's id.
- script_description: two to five English sentences that summarize everything the script states about the character's appearance and presence, in your own words, with no invented detail.

## STEP 3: LOCATIONS
- One entry per distinct physical space that needs its own design. The scene heading is the main signal.
- Separate rooms or areas of one place (a house's kitchen and bedroom) are separate entries that share the same location_group ("Karimi house"). Interior and exterior of the same building are separate entries in the same group.
- The same space at a different time of day, or in a different condition (after a fire, decorated for a wedding), is the SAME entry. Record conditions in states with scene_refs and evidence. Set time_of_day to the most frequent time across its scenes and list all of them in times_of_day.
- A scene that takes place inside a vehicle (INT. CAR) is a location. The vehicle seen from outside is a prop. Link the two through related_asset_ids.
- interior_exterior: interior, exterior, or int_ext (INT./EXT. headings, or a scene that moves through a doorway).
- "VARIOUS", montage and "intercut" headings: create entries only for places the text actually describes, and warn "AMBIGUOUS: ..." for the rest. A phone call intercut between two places uses both locations.
- fixed_elements_from_script: built-in and permanent things the script places in the space (a big window, a fireplace, the bar counter, shelves of jars) that nobody moves or uses as an object. These belong to the location design, not to props.
- script_description: two to five English sentences on everything the script says about the space: type, size, era, condition, light, sound, mood words and fixed elements.
- Every location with at least one scene is asset_priority required.

## STEP 4: PROPS
An object becomes a prop asset if AT LEAST ONE of these is true:
a. a character handles, carries, uses, gives, takes, hides, opens, breaks or otherwise interacts with it;
b. the plot depends on it, or dialogue refers to it as a specific object;
c. it appears in two or more scenes and must look the same each time (continuity);
d. the script describes it specifically (an inscription, a color, damage, a maker, a unique feature);
e. it is a vehicle that is shown.
Never a prop: clothing and costume (character wardrobe), body parts, weather, fire, light and other effects, built-in fixtures and furniture nobody interacts with (location fixed_elements_from_script), and generic background clutter. A piece of furniture or a fixture becomes a prop only when it moves, changes state or is singled out (the painting that gets stolen, the chair thrown through the window).
Food and everyday items handled once with no description are props with asset_priority optional. All other props are required, except set_dressing that appears in only one scene, which is optional.

Fields:
- category_hint: hero_prop (central to the plot, needs close-ups), hand_prop (held or carried), functional_prop (must visibly work on screen: opens, lights up, fires, displays, moves), set_dressing (placed in a space, not handled, but needs continuity), prop_group (a set of similar items treated as one asset: "a stack of unopened letters"). Choose the single best fit; hero_prop wins when several fit.
- subtype: a short free label when useful (vehicle, weapon, document, phone or screen, jewelry, food, container, tool); otherwise null.
- states: every condition the script requires (sealed / torn open, intact / shattered, off / glowing) with scene_refs and evidence. The default condition is the first state.
- text_on_object: any wording the script says is written on the object, kept exactly.
- users: ids of the characters who handle it. location_ids: ids of the locations where it appears.
- A real brand named in the script is recorded as a fact with its evidence; the Prop Generator replaces it later.

## STEP 5: CROSS-CHECK BEFORE SUBMITTING
Fix any failure before you call the tool:
1. Every scene in the script has exactly one scene_index entry, in script order.
2. A scene is in a character's scene_refs if and only if the character is in that scene's characters_present (seen) or heard_only (heard, not seen). The same holds for props (props_present) and locations (location_id). Every id in a scene's speakers is also in its characters_present or heard_only, and has speaks true.
3. Every speaking label in the dialogue maps to a character, and every scene with dialogue has a non-empty speakers list.
4. No two entries of the same type share a name or alias, unless they are linked with same_person_as or flagged MERGE_CHECK.
5. Every asset has at least one scene_ref, and first_scene is its earliest scene.
6. Every evidence excerpt is copied exactly from the script.
7. summary counts equal the array lengths.

# EVIDENCE RULES
- evidence is an exact excerpt of the script, at most 20 words, copied character for character in the script's original language, so the backend can verify it automatically. Never translate, fix spelling or paraphrase inside evidence.
- Every fact, look, state, fixed element and text_on_object needs evidence. If you cannot quote a cue, do not record the fact.

# LANGUAGE
- The script may be in any language (often Persian or English).
- name: the label exactly as the script writes it. name_latin: a romanized ASCII form of the name for prompts and file names (for example "Sara Karimi"); for unnamed characters, a short English label ("old fisherman").
- facts values, script_description, states, looks and every field read by other dami: English.
- ui_summary: one short line in project.ui_language that tells the user what this asset is and where it appears.
- assumptions and warnings: English, short, human-readable.

# INCREMENTAL MODE
known_assets come from an earlier episode or an earlier version of the script.
- Match every detected asset to a known asset by name, alias and description before creating a new one. A match keeps the known id.
- Never rename or redescribe an asset with status "approved". If the script now calls it differently, add the new label to aliases. If the script now states a different physical fact about an approved asset, keep the asset unchanged and warn "APPROVED_CONFLICT: <id> ... (scene, evidence)".
- For a series, a known asset that does not appear in this episode is simply left out of this output. For an edited script of the same episode, a known asset that is no longer found is listed in diff.removed and is not output; never delete it silently.
- diff.added: new ids. diff.updated: known ids whose aliases, scene_refs, looks, states or facts changed. In full mode all three diff lists are empty.

# FIX MODE
Apply every request in fix_requests to previous_output in one round. Change only what the requests need and keep everything else identical, including ids, order and wording.
- ADT01 missing asset: search the script for what custom_text names. If found, add it with full evidence and update scene_index. If it is not in the script, do not add it; warn "NOT_IN_SCRIPT: ..." so the platform can offer a manual asset.
- ADT02 duplicate: merge the targets into one entry. Keep the id of an approved target if there is one, otherwise the lowest id. Merge aliases, facts, looks, states and scene_refs, rewrite the description and update every reference to the removed ids. List removed ids in diff.removed.
- ADT03 two in one: split the target into two entries using custom_text and the script, assign scenes and evidence to each, and update every reference.
- ADT04 wrong category: move the asset to the correct type with a new id of that type, rebuild the fields that type needs from the script, and update every reference. Report the old id in diff.removed and the new one in diff.added.
- ADT05 wrong details: re-read every fact of the target against the script; remove facts without valid evidence and correct the rest.
- ADT06 wrong scenes: re-scan the script for the target and rebuild its scene_refs and the scene_index entries.
- ADT07 wrong name or role: apply custom_text when the script supports it, otherwise re-derive name and role from the script.
- ADP02 make this a separate asset: promote the named thing (a fixed element, a background figure, an object) to its own entry with evidence, and remove it from where it was recorded before.
- ADP03 own asset for a look or state: turn the target look or state into a separate entry linked with same_person_as (characters) or related_asset_ids (locations, props), and move its scenes.
- ADP04 group these: merge the target props into one prop_group entry.
- ADP99 and any other code: follow instruction and custom_text as far as the script allows.
- A request that would require inventing content not in the script is not applied; add a warning instead.
List each applied request in applied_fixes as {code, target_ids, change}. In full and incremental mode applied_fixes is empty.

# WARNINGS (prefix every warning with one of these tags)
MERGE_CHECK:, NO_LOCATION:, AMBIGUOUS:, MINOR_PRESENT:, REAL_PERSON: (a real, identifiable public figure appears as a character; the platform decides how to handle it), APPROVED_CONFLICT:, NOT_IN_SCRIPT:, SCRIPT_GAP: (the script is too thin to detect a category, for example no location information at all), UNUSABLE_INPUT: (the input is not a script). If the input is not a script, return empty arrays and an UNUSABLE_INPUT warning.

# ASSUMPTIONS
List every judgment the script did not settle that changed the output: a continued location, an implied age range, a borderline prop included or excluded, a merge you made. Keep each one short.
```

---

## 6. User message template

```
<input>
{{INPUT_JSON}}
</input>
```

`INPUT_JSON` holds the whole input object of section 2, including the script. Send the script text unchanged (no trimming of dialogue), because evidence is verified against it.

---

## 7. Review and fix loop

- Every Pre-production category screen (char, loc, prop) has a **"Something wrong with this list?"** button and a menu on each asset card. Both follow the standard reject flow: technical or preference, then reasons from `asset_detector_review_catalog_v1.json`.
- Technical `ADT01` to `ADT07`, preference `ADP01` to `ADP04` and `ADP99`, action `ADR01` (re-scan, mode incremental). `ADP01` is backend only (sets `skipped`, no Claude call).
- Backend operations without Claude: `BO01` rename, `BO02` delete, `BO03` manual add (also the answer to `NOT_IN_SCRIPT:`), `BO04` edit facts (Pro).
- Wizard sees `ADT01` to `ADT06`, `ADP01`, `ADP02`, `ADP99`, `ADR01`. Pro sees everything.
- Requests touching an approved asset are confirmed in the UI first.

---

## 8. Backend notes and validators

**Validate before storing (re-run once with the errors appended as `fix_requests` of type technical, code `ADT05`/`ADT06`, if any fail):**
1. Schema valid; `summary` counts equal array lengths.
2. Every scene of the input has one `scene_index` entry in order; no extra scenes.
3. Every id used anywhere exists; every asset has `scene_refs`; `first_scene` is the earliest.
4. Scene consistency: char in `characters_present` or `heard_only` ⇔ scene in the char's `scene_refs`; every id in `speakers` is in one of those two lists and has `speaks: true`; same for props and locations.
5. Evidence check: normalize whitespace and the Persian/Arabic forms of ی/ي and ک/ك, then check each `evidence` is a substring of the script. Drop facts that fail and add an assumption line "fact removed: evidence not found". More than 10% failures → re-run once.
6. A scene whose text contains dialogue has a non-empty `speakers` list.
7. No duplicate `name` or alias inside one type unless linked by `same_person_as` or a `MERGE_CHECK:` warning.

**Other**
- Show `MERGE_CHECK:`, `NO_LOCATION:`, `AMBIGUOUS:` and `REAL_PERSON:` warnings on the category screens as small banners with one-tap fixes (merge, pick location).
- `MINOR_PRESENT:` is not shown to the user; it is passed to the Character Generator and later dami.
- Store `asset_priority: "skipped"` for ADP01. The dami never outputs it.
- If `stop_reason` is `max_tokens` (very long scripts), split the script into scene ranges and run the rest in incremental mode with what was already detected as `known_assets`.
- Long scripts: one call per episode is the normal case. A feature-length script fits one call.
- Slice `script_context` for the generators from `scene_index` and the script: only scenes in the asset's `scene_refs`.

---

## 9. Tests

1. **Aliases:** SARA, MRS. KARIMI and MOM are one person. Expect one entry with two aliases.
2. **Reveal:** "the hooded stranger" is revealed as Reza in scene 9. Expect one entry, or `MERGE_CHECK:` if the reveal is unclear.
3. **Age forms:** young Ali (8) in a flashback and Ali (40). Expect two entries, `same_person_as`, `is_minor: "yes"` on the child and a `MINOR_PRESENT:` warning.
4. **Looks:** Sara in a wedding dress in scene 12 only. Expect one entry with a look, `char_looks` filled in scene 12.
5. **Fixture vs prop:** "a fireplace" (nobody touches it) and "she throws the letter into the fireplace". Expect the fireplace in `fixed_elements_from_script`, the letter as a prop with states intact / burning.
6. **Vehicle:** INT. TAXI and EXT. STREET where the taxi drives away. Expect a taxi-interior location and a taxi prop (subtype vehicle), linked.
7. **Day/night:** the same kitchen in morning and night scenes. Expect one location, `times_of_day` with both.
8. **Phone call intercut:** two places, a voice heard on the phone. Expect both locations, the caller in `heard_only` and `speakers`, with `voice_delivery` `phone_or_device`.
14. **Voice hints:** "he speaks with a heavy Tabrizi accent". Expect a `voice_hints` fact with that evidence, nothing about the voice invented from appearance.
9. **Persian script:** names kept in Persian, `name_latin` romanized, evidence in Persian, descriptions in English, `ui_summary` in Persian.
10. **Raw upload without headings:** expect sensible scene splits, `anchor` filled, assumptions for every inferred split.
11. **Incremental, series ep 2:** approved char from ep 1 called by a nickname. Expect the same id, nickname added to aliases, `diff.updated`.
12. **Fix ADT01 for something not in the script:** expect no new asset and a `NOT_IN_SCRIPT:` warning.
13. **Not a script** (a recipe): expect empty arrays and `UNUSABLE_INPUT:`.

---

## 10. Open

- `voice_only` characters (narrator, unseen caller) are kept in `characters[]` with `needs_visual: false`; the char screen hides them in Pre-production and they reappear in Production's voice box.
- Order with output_22: recommended that the output_22 dami runs after this one and receives output_21, so its prompts use asset ids. Decide in the output_22 chat.
- Script Checker contract: ideally it returns uploaded scripts as `scenes[]` with numbers so the `raw_text` fallback is rarely used.
- Effects (fire, rain, magic glow) are not assets in v1; output_22 and Text Blocks read them from the script.
