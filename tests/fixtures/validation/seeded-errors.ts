// Import files with deliberately seeded errors: at least one example of every
// problem the validation report covers (spec §5), plus rows that are valid and
// rows that are read with a note. Kept as TypeScript strings rather than .csv
// files so .gitignore's participant-data rule (no .csv outside
// public/templates/) needs no exception. The e2e test writes them to files.
//
// Row numbers are spreadsheet rows: the header is row 1.

export const seededMembersCsv = [
  'id,display_name,team,level,location,tenure_band,manager_id,Office floor', // 1
  'A01,Ada Example,Finance,L4,Leeds,Over 5 years,,3', // 2 valid
  'A02,Bram Example,Finance,L2,Leeds,1 to 3 years,A01,3', // 3 valid
  'A03,Chiara Example,Operations,L3,Bristol,,A01,', // 4 valid
  'A04,,Operations,L1,Bristol,,A03,', // 5 missing display_name
  'A05,Dev Example,Sales,L2,Glasgow,,A05,', // 6 own manager
  'A06,Elif Example,Sales,L2,Glasgow,,Z99,', // 7 unknown manager id
  'A07,Farah Example,People,L1,Leeds,,,', // 8 duplicate id (with 9)
  'A07,Gideon Example,People,L1,Leeds,,,', // 9 duplicate id (with 8)
  ',Hana Example,People,L1,Leeds,,,', // 10 missing id
  'A08,Ivo Example,People,L2,Leeds,,A04,', // 11 manager A04 is skipped (row 5)
].join('\n');

export const seededTiesCsv = [
  'rater_id,ratee_id,variable,value,wave', // 1
  'A01,A02,connection_strength,4,1', // 2 valid
  'A02,A01,connection_strength,0,', // 3 valid: a rated 0; empty wave is wave 1
  'A01,A03,valence,-2,1', // 4 valid
  'A03,A01,valence,,1', // 5 valid: empty value is "not rated", stored as null
  'A01,Z99,connection_strength,3,1', // 6 unknown id
  'A02,A02,connection_strength,3,1', // 7 self-rating
  'A01,A02,valence,4,1', // 8 out of range (valence is -3 to 3)
  'A03,A02,connection_strength,6,1', // 9 out of range (0 to 5)
  'A02,A03,connection_strength,three,1', // 10 non-numeric
  'A02,A03,connection_strngth,2,1', // 11 unknown variable
  'A03,A02,informal_collaboration,2,1', // 12 duplicate (with 13)
  'A03,A02,informal_collaboration,3,1', // 13 duplicate (with 12)
  'A01,A03,formal_collaboration,"2,5",1', // 14 non-numeric: a decimal comma is not guessed at
  'A01,A03,connection_strength,3,0', // 15 invalid wave
  'A04,A01,connection_strength,2,1', // 16 unknown id: A04's members row is skipped
  'A01,A02,Connection strength,2,1', // 17 unknown variable: a label, not a key
  'A01,A03,advice,3,1', // 18 valid, for a layer that is turned off
  'A01,A03,connection_strength,4,2', // 19 valid, wave 2
  'A01,A03,primary_channel,phone,1', // 20 not a category
  ',A03,valence,1,1', // 21 missing rater
  'A02,A03,valence, +1 ,1', // 22 valid: +1
  'A02,A01,valence,1e0,1', // 23 non-numeric: exponent notation is not read
  'A03,A01,"connection_strength,2,1', // 24 unclosed quote
].join('\n');

/** Every error the report must list, by file, row and code. */
export const expectedErrors = {
  members: [
    [5, 'missing_field'],
    [6, 'self_manager'],
    [7, 'unknown_id'],
    [8, 'duplicate_id'],
    [9, 'duplicate_id'],
    [10, 'missing_field'],
    [11, 'unknown_id'],
  ],
  ties: [
    [6, 'unknown_id'],
    [7, 'self_rating'],
    [8, 'out_of_range'],
    [9, 'out_of_range'],
    [10, 'non_numeric'],
    [11, 'unknown_variable'],
    [12, 'duplicate'],
    [13, 'duplicate'],
    [14, 'non_numeric'],
    [15, 'invalid_wave'],
    [16, 'unknown_id'],
    [17, 'unknown_variable'],
    [20, 'unknown_category'],
    [21, 'missing_field'],
    [23, 'non_numeric'],
    [24, 'malformed_row'],
  ],
} as const;

export const expectedCounts = {
  members: { total: 10, valid: 3, skipped: 7 },
  ties: { total: 23, valid: 7, skipped: 16 },
} as const;
