import {createFileRoute} from '@tanstack/react-router';
async function handle({request}:{request:Request}){const {handleApi}=await import('../api/index.server');return handleApi(request);}
export const Route=createFileRoute('/api/$')({server:{handlers:{GET:handle,POST:handle,DELETE:handle,PUT:handle,PATCH:handle,OPTIONS:handle}}});
