'use strict';
const C=require('./common.cjs');
const lease=C.read('run/lease.json');
if(process.argv[2]&&lease&&lease.id!==process.argv[2])process.exit(0);
process.exit(C.cleanup()?0:1);
