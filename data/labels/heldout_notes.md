# Held-out labeling notes

## Three spans missed by the output extractor

All three details appear in the full output:

- `5 or more drinks` appears in the men’s binge-drinking bullet as “Having 5 or more drinks within a few hours.”
- `4 or more drinks` appears in the women’s binge-drinking bullet as “Having 4 or more drinks within a few hours.”
- `More than 45mg/dL` appears in the children’s and teens’ HDL row as “More than 45 mg/dL.” The output inserts a space between the number and unit.

## Changes outside labeled spans

- **Day 2, 01-a1c:** Source “above 6.5%” became “6.5% or higher.” The cutoff wording changed from strictly above to inclusive of 6.5%; percentages are outside the locked span list.
- **02-alcohol:** The source BAC phrase “0.08% or more” became “0.08% or higher”; the threshold wording is equivalent, and percentages are excluded. In the heavy-drinking bullets, “on any day” became “in one day” for men and women; the daily threshold is retained, but this window is outside the labeled span.
- **04-backpain:** “8 out of 10 people” became “About 8 out of 10 people,” adding approximation to an excluded people count.
- **06-calcium:** “Pregnant and breastfeeding teens/adults” became “Pregnant or breastfeeding teens/adults.” This changes the group connector outside the repeated amount spans.
- **08-cholesterollevelswhatyouneedtoknow:** “Age 19 or younger” and “age 20 or older” headings became “Age 19 and Younger” and “Age 20 and Older.” The phrasing changes, but the age groups remain the same. The source HDL cutoff “Greater than or equal to 60 mg/dL” became “60 mg/dL or higher”; the quantity span is retained and the comparator is outside that span.
- **14-foodborneillness:** “Around 48 million people” became “about 48 million people,” an equivalent approximation of an excluded people count.
- **18-highcholesterolinchildrenandteens:** “Aged 19 or younger” became the heading “Age 19 and Younger.” The age value is retained; the qualifier wording changes outside the `aged 19` span. “Between ages 9 to 11” became “between ages 9 and 11,” retaining the endpoints.
- **20-indigestion:** “At one time” became “at some point”; the wording changes, but neither phrase forms a locked time span.
