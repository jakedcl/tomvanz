import {defineArrayMember, defineField, defineType} from 'sanity'

import {FlightLogInput} from '../components/FlightLogInput'

/**
 * Hidden telemetry for the altitude chart (~1 Hz). Shape: `{t,lng,lat,height,speed,heading,gimbalPitch,battery,mode}`[].
 * `t` is seconds from flight start. Not loaded by mapQuery; fetched when the flight card opens.
 */
const SERIES_DESCRIPTION =
  'JSON array of ~1 Hz samples: {t,lng,lat,height,speed,heading,gimbalPitch,battery,mode}. Filled by bulk upload / parse; do not edit.'

/** Simplified map line (lng/lat pairs), same encoding as tracks’ `displayCoordinates`. */
const DISPLAY_COORDS_DESCRIPTION =
  'JSON array of [lng, lat] pairs, Douglas–Peucker simplified from the GPS track. Filled automatically; do not edit.'

export const flight = defineType({
  name: 'flight',
  title: 'Flight',
  type: 'document',
  fields: [
    defineField({
      name: 'title',
      title: 'Title',
      type: 'string',
      validation: (Rule) => Rule.required(),
    }),
    defineField({
      name: 'startedAt',
      title: 'Start time',
      type: 'datetime',
    }),
    defineField({
      name: 'place',
      title: 'Place',
      type: 'string',
      description: 'Short label for takeoff area (reverse-geocoded when uploaded).',
    }),
    defineField({
      name: 'durationSeconds',
      title: 'Duration (s)',
      type: 'number',
      readOnly: true,
    }),
    defineField({
      name: 'distanceMeters',
      title: 'Distance (m)',
      type: 'number',
      readOnly: true,
      description: 'Path length from decoded GPS track (not the log header).',
    }),
    defineField({
      name: 'maxHeightMeters',
      title: 'Max height (m)',
      type: 'number',
      readOnly: true,
    }),
    defineField({
      name: 'aircraft',
      title: 'Aircraft',
      type: 'string',
      description: 'Drone model, e.g. DJI Mini 3.',
    }),
    defineField({
      name: 'log',
      title: 'Flight log',
      type: 'file',
      options: {accept: '.txt,text/plain'},
      components: {input: FlightLogInput},
    }),
    defineField({
      name: 'displayCoordinates',
      title: 'Display coordinates',
      type: 'text',
      hidden: () => true,
      readOnly: () => true,
      description: DISPLAY_COORDS_DESCRIPTION,
    }),
    defineField({
      name: 'series',
      title: 'Telemetry series',
      type: 'text',
      hidden: () => true,
      readOnly: () => true,
      description: SERIES_DESCRIPTION,
    }),
    defineField({
      name: 'home',
      title: 'Home point',
      type: 'geopoint',
      hidden: () => true,
    }),
    defineField({
      name: 'videoSegments',
      title: 'Video segments',
      type: 'array',
      hidden: () => true,
      readOnly: () => true,
      of: [
        defineArrayMember({
          type: 'object',
          fields: [
            defineField({name: 'startSeconds', type: 'number'}),
            defineField({name: 'endSeconds', type: 'number'}),
          ],
        }),
      ],
    }),
    defineField({
      name: 'sourceFilename',
      title: 'Source file name',
      type: 'string',
      readOnly: true,
    }),
    defineField({
      name: 'includeOnMap',
      title: 'Show on map',
      type: 'boolean',
      description: 'Short flights (under 1 min) stay off the map until you turn this on.',
      initialValue: true,
    }),
  ],
  preview: {
    select: {title: 'title', aircraft: 'aircraft', startedAt: 'startedAt', place: 'place'},
    prepare({title, aircraft, startedAt, place}) {
      const when = startedAt ? new Date(startedAt).toLocaleDateString() : undefined
      return {
        title: title || 'Flight',
        subtitle: [aircraft, place, when].filter(Boolean).join(' · ') || undefined,
      }
    },
  },
})