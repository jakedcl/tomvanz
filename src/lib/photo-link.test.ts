import {describe, expect, it} from 'vitest'
import {photoLink} from './photo-link'

const base = {location: {lat: 0, lng: 0}, title: ''}
const data = {
  pins: [
    {_id: 'p1', ...base, flightId: 'f1', routeId: 'r1'},
    {_id: 'p2', ...base, routeId: 'r1'},
    {_id: 'p3', ...base, flightId: 'gone'},
    {_id: 'p4', ...base},
  ],
  flights: [{_id: 'f1', title: 'Sunset flight'}],
  tracks: [{_id: 'r1', title: ''}],
} as unknown as Parameters<typeof photoLink>[0]

describe('photoLink', () => {
  it('prefers the flight', () => {
    expect(photoLink(data, 'p1')).toMatchObject({kind: 'flight', id: 'f1', title: 'Sunset flight', target: {kind: 'flight', id: 'f1', fly: true}})
  })
  it('falls back to the route, with a default name', () => {
    expect(photoLink(data, 'p2')).toMatchObject({kind: 'track', id: 'r1', title: 'Route'})
  })
  it('is null when the link points at something not on the map, or there is none', () => {
    expect(photoLink(data, 'p3')).toBeNull()
    expect(photoLink(data, 'p4')).toBeNull()
    expect(photoLink(data, 'nope')).toBeNull()
  })
})
