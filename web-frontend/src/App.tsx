import type {Component} from 'solid-js';
import {createResource} from 'solid-js'
import {fetchAPIData} from './api'
import DataDisplay from './components/DataDisplay'

const App: Component = () => {
    const [data, {mutate, refetch}] = createResource(fetchAPIData)

    return (
        <>
            {data.loading && <p class="text-4xl text-center py-20">Loading...</p>}

            {!data.loading && <div class="flex items-center justify-center w-screen mt-4 flex-col gap-y-5">
                <DataDisplay data={data()}/>
            </div>}
        </>
    );
};

export default App;
