/**
 * OpenSpec inline template constants.
 * Used by `backlog spec create` and `backlog change create` to scaffold new files.
 */

export const SPEC_TEMPLATE = `## Purpose

Describe the purpose of this specification.

## Requirements

### Requirement: placeholder-requirement

The system SHALL satisfy this requirement.

#### Scenario: basic-behavior

GIVEN a starting state
WHEN an action occurs
THEN an expected outcome happens
`;

export const PROPOSAL_TEMPLATE = `## Why

Explain the motivation and background for this change. Why is it needed? What problem does it solve? This section should be at least 50 characters.

## What Changes

Summarize the changes being proposed. What deltas will be applied, and to which specs?
`;

export const DESIGN_TEMPLATE = `## Overview

Provide a high-level overview of the design approach.

## Architecture

Describe the architecture, components, and how they interact.

## Tradeoffs

Discuss tradeoffs, alternatives considered, and why this approach was chosen.
`;
