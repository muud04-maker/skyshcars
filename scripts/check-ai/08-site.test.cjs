// PART 8 â€” the public WhatsApp enquiry must always carry the stock number AND the vehicle name.
const test = require('node:test');
const assert = require('node:assert/strict');
const load = require('./lib.cjs');
const { vehicleEnquiryMessage } = load('site.js');

const DASH = '\u2014';

test('PART 8: the WhatsApp enquiry names the exact car by stock number and name', () => {
  const msg = vehicleEnquiryMessage('SC00129', '2014 Chevrolet Trax');
  assert.equal(msg, `Hello Sky Cars, I am interested in SC00129 ${DASH} 2014 Chevrolet Trax.`);
  assert.ok(msg.includes('SC00129'));
  assert.ok(msg.includes('2014 Chevrolet Trax'));
});

test('PART 8: the vehicle page link is appended when given', () => {
  const msg = vehicleEnquiryMessage('SC-1001', '2019 Toyota Harrier', 'https://skyshcars.com/vehicles/12');
  assert.ok(msg.startsWith('Hello Sky Cars, I am interested in SC-1001'));
  assert.ok(msg.endsWith('https://skyshcars.com/vehicles/12'));
});

test('PART 8: missing parts never leave a dangling separator', () => {
  assert.equal(vehicleEnquiryMessage('', '2019 Toyota Harrier'), 'Hello Sky Cars, I am interested in 2019 Toyota Harrier.');
  assert.equal(vehicleEnquiryMessage('SC00129', ''), 'Hello Sky Cars, I am interested in SC00129.');
});
