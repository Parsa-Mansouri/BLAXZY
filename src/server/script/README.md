# script

The Script stage (`docs/M1_CONTRACTS.md`): script versions (generated, uploaded, revised, edited),
reviews, and the jobs that produce them (`worker/handlers/script-*.ts`). Versions are append-only;
only `status`, `decidedAt` and the dami result of a pending version change. `extract.ts` reads
uploaded documents.
