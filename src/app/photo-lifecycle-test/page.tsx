import {notFound} from 'next/navigation';
import PhotoHarness from './PhotoHarness';

export const dynamic='force-dynamic';

export default function PhotoTestPage(){
  if(process.env.PHOTO_TEST_ROUTE!=='1')notFound();
  return <main style={{padding:24}}><PhotoHarness/></main>;
}
