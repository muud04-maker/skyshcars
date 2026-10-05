// PART 4 â€” strict matching wired to the per-chat CURRENT CAR.
// The matcher must return nothing for a pure follow-up ("how much is it?", "send photos"), so the
// reply is answered from the car we are already discussing instead of matching a random vehicle.
const test = require('node:test');
const assert = require('node:assert/strict');
const load = require('./lib.cjs');
const { matchVehicles } = load('ai-rules/match.js');
const { followUpTopic, refersToCurrentCar, hasNoVehicleEvidence } = load('ai-rules/vehicle-intent.js');

const FLEET = [
  { id: 1, stock_no: 'SC-1001', brand: 'Toyota', model: 'Harrier', trim_name: 'Hybrid', model_year: 2019 },
  { id: 2, stock_no: 'SC-1002', brand: 'Haval', model: 'Raptor', trim_name: '', model_year: 2023 },
  { id: 3, stock_no: 'SC-1003', brand: 'Toyota', model: 'RAV4', trim_name: '', model_year: 2011 },
  { id: 4, stock_no: 'SC-1004', brand: 'Toyota', model: 'Prado', trim_name: '', model_year: 2016 },
];
const ONLY_TOYOTA = FLEET.filter((v) => /toyota/i.test(String(v.brand)));

test('PART 4 intent: follow-up topics are recognised', () => {
  assert.equal(followUpTopic('how much is it?'), 'price');
  assert.equal(followUpTopic('price?'), 'price');
  assert.equal(followUpTopic('send me photos'), 'photos');
  assert.equal(followUpTopic('is it still available?'), 'availability');
  assert.equal(followUpTopic('what is the mileage?'), 'specs');
  assert.equal(followUpTopic('can you ship it to Somalia?'), 'shipping');
  assert.equal(followUpTopic('Do you have a Toyota Harrier?'), null);
});

test('PART 4 intent: follow-ups and anaphora point at the current car', () => {
  assert.equal(refersToCurrentCar('how much is it?'), true);
  assert.equal(refersToCurrentCar('send photos'), true);
  assert.equal(refersToCurrentCar('is it still available?'), true);
  assert.equal(refersToCurrentCar('send photos of the white one'), true);
  assert.equal(refersToCurrentCar('what is the mileage?'), true);
});

test('PART 4 intent: a fresh car request does NOT point at the current car', () => {
  assert.equal(refersToCurrentCar('Do you have a Toyota Harrier?'), false);
  assert.equal(refersToCurrentCar('I want a Prado 2016'), false);
  // "Both" / "Ok" are answers to our question, not follow-ups about the current car.
  assert.equal(refersToCurrentCar('Both'), false);
  assert.equal(refersToCurrentCar('Ok'), false);
});

test('PART 4: the strict matcher returns nothing for a pure follow-up (current car must answer it)', () => {
  assert.equal(matchVehicles('how much is it?', FLEET).kind, 'none');
  assert.equal(matchVehicles('send me the photos', FLEET).kind, 'none');
  assert.equal(matchVehicles('is it still available?', FLEET).kind, 'none');
  assert.equal(hasNoVehicleEvidence('how much is it?'), true);
});

test('PART 4: a named car still matches, and the year disambiguates', () => {
  const harrier = matchVehicles('Toyota Harrier', FLEET);
  assert.equal(harrier.kind, 'one');
  assert.equal(harrier.vehicle.id, 1);
  const rav = matchVehicles('RAV4 2011', FLEET);
  assert.equal(rav.kind, 'one');
  assert.equal(rav.vehicle.id, 3);
});

test('PART 4: a car that is not in the AI catalog can never match (old-stock guard)', () => {
  // Haval Raptor is not in this (AI-catalog) list, so it must not be offered.
  assert.equal(matchVehicles('Haval Raptor', ONLY_TOYOTA).kind, 'none');
  // "Harrier hybrid" must resolve to the Harrier only, never to another brand.
  const m = matchVehicles('Harrier hybrid', FLEET);
  assert.equal(m.kind, 'one');
  assert.equal(m.vehicle.id, 1);
});

test('PART 4: a stock number in a follow-up still resolves', () => {
  const m = matchVehicles('send photos of SC-1004', FLEET);
  assert.equal(m.kind, 'one');
  assert.equal(m.vehicle.id, 4);
});
