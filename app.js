importScripts("https://cdn.jsdelivr.net/pyodide/v0.21.3/full/pyodide.js");

function sendPatch(patch, buffers, msg_id) {
  self.postMessage({
    type: 'patch',
    patch: patch,
    buffers: buffers
  })
}

async function startApplication() {
  console.log("Loading pyodide!");
  self.postMessage({type: 'status', msg: 'Loading pyodide'})
  self.pyodide = await loadPyodide();
  self.pyodide.globals.set("sendPatch", sendPatch);
  console.log("Loaded!");
  await self.pyodide.loadPackage("micropip");
  const env_spec = ['https://cdn.holoviz.org/panel/0.14.0/dist/wheels/bokeh-2.4.3-py3-none-any.whl', 'https://cdn.holoviz.org/panel/0.14.0/dist/wheels/panel-0.14.0-py3-none-any.whl', 'holoviews>=1.15.1', 'pandas']
  for (const pkg of env_spec) {
    const pkg_name = pkg.split('/').slice(-1)[0].split('-')[0]
    self.postMessage({type: 'status', msg: `Installing ${pkg_name}`})
    await self.pyodide.runPythonAsync(`
      import micropip
      await micropip.install('${pkg}');
      from pyodide.http import pyfetch
      response = await pyfetch("https://raw.githubusercontent.com/pat-schmitt/test_stuff/main/app_data.zip")
      await response.unpack_archive()
    `);
  }
  console.log("Packages loaded!");
  self.postMessage({type: 'status', msg: 'Executing code'})
  const code = `
  
import asyncio

from panel.io.pyodide import init_doc, write_doc

init_doc()

import pandas as pd

import panel as pn
import holoviews as hv
from holoviews import opts

pn.extension()
hv.extension('bokeh', width=100)

# load data
df_gmt = pd.read_csv('magicc_ts.csv', index_col=0)
df_gmt_n = df_gmt[[c for c in df_gmt.columns if 'netzero' in c]].copy()
df_gmt_c = df_gmt[[c for c in df_gmt.columns if 'zeroCO2' in c]].copy()

df_slr_n = pd.read_csv('global_slr_netzero.csv', index_col=0)
df_slr_c = pd.read_csv('global_slr_zeroCO2.csv', index_col=0)

# define possible values and style
peak_years_all = [2020, 2025, 2030, 2035, 2040, 2045, 2050]
dec_rates_all_dict = {0.3: 'solid', 0.5: 'dashed', 0.7: 'dotted'}
scenarios_all = ['netzero', 'zeroCO2']

dec_rates_all = list(dec_rates_all_dict)

# create holomaps for plotting
gmt_dict = {}
gmt_dict_background = {}

slr_dict = {}
slr_dict_background = {}

for szenario in ['netzero', 'zeroCO2']:
    for py in peak_years_all:
        for decr in dec_rates_all:
            key = f'{szenario}_py{py}_fac1.0_decr{decr}'

            if szenario == 'netzero':
                gmt_data = df_gmt_n[key]
                slr_data = df_slr_n[key]
            elif szenario == 'zeroCO2':
                gmt_data = df_gmt_c[key]
                slr_data = df_slr_c[key]

            for used_dict, used_data, used_name in zip(
                    [[gmt_dict, gmt_dict_background], [slr_dict, slr_dict_background]],
                    [gmt_data, slr_data],
                    ['GMT above preindustrial (°C)', 'SLRG (mm)']):
                used_data.name = used_name
                used_dict[0][(szenario, py, decr)] = hv.Curve(used_data).opts(
                    line_dash=dec_rates_all_dict[decr])
                used_dict[1][(szenario, py, decr)] = hv.Curve(used_data).opts(color='lightgray',
                                                                              alpha=0.5)

gmt_holomap = hv.HoloMap(gmt_dict, kdims=['szenario', 'peak_year', 'decrease_rate'])
gmt_holomap_background = hv.HoloMap(gmt_dict_background,
                                    kdims=['szenario', 'peak_year', 'decrease_rate'])

slr_holomap = hv.HoloMap(slr_dict, kdims=['szenario', 'peak_year', 'decrease_rate'])
slr_holomap_background = hv.HoloMap(slr_dict_background,
                                    kdims=['szenario', 'peak_year', 'decrease_rate'])

# sliders
peak_years_slider_values = peak_years_all.copy()
dec_rates_slider_values = dec_rates_all.copy()
scenarios_slider_values = scenarios_all.copy()

peak_years_slider_values.insert(0, 'all')
dec_rates_slider_values.insert(0, 'all')
scenarios_slider_values.insert(0, 'all')

scenario_slider = pn.widgets.DiscreteSlider(name='Scenario', options=scenarios_slider_values, value='all')
peak_year_slider = pn.widgets.DiscreteSlider(name='Peak Year', options=peak_years_slider_values, value='all')
decrease_rate_slider = pn.widgets.DiscreteSlider(name='Decrease Rate', options=dec_rates_slider_values, value='all')


# plot function and DynamicMap
def gmt_plot(scenario, py, decr):
    if scenario == 'all':
        scenario = scenarios_all
    else:
        scenario = [scenario]

    if py == 'all':
        py = peak_years_all
    else:
        py = [py]

    if decr == 'all':
        decr = dec_rates_all
    else:
        decr = [decr]

    plot = ((gmt_holomap_background.overlay() * gmt_holomap[scenario, py, decr].overlay()).opts(
        title='net-zero CO2') +
            slr_holomap_background.overlay() * slr_holomap[scenario, py, decr].overlay())
    return plot.opts(width=800,
                     height=400)


dmap_gmt = hv.DynamicMap(
    pn.bind(gmt_plot, scenario=scenario_slider, py=peak_year_slider, decr=decrease_rate_slider))

# the actual app
gmt_app = pn.Row(pn.Column(scenario_slider, peak_year_slider, decrease_rate_slider), dmap_gmt)
gmt_app.servable()


await write_doc()
  `
  const [docs_json, render_items, root_ids] = await self.pyodide.runPythonAsync(code)
  self.postMessage({
    type: 'render',
    docs_json: docs_json,
    render_items: render_items,
    root_ids: root_ids
  });
}

self.onmessage = async (event) => {
  const msg = event.data
  if (msg.type === 'rendered') {
    self.pyodide.runPythonAsync(`
    from panel.io.state import state
    from panel.io.pyodide import _link_docs_worker

    _link_docs_worker(state.curdoc, sendPatch, setter='js')
    `)
  } else if (msg.type === 'patch') {
    self.pyodide.runPythonAsync(`
    import json

    state.curdoc.apply_json_patch(json.loads('${msg.patch}'), setter='js')
    `)
    self.postMessage({type: 'idle'})
  } else if (msg.type === 'location') {
    self.pyodide.runPythonAsync(`
    import json
    from panel.io.state import state
    from panel.util import edit_readonly
    if state.location:
        loc_data = json.loads("""${msg.location}""")
        with edit_readonly(state.location):
            state.location.param.update({
                k: v for k, v in loc_data.items() if k in state.location.param
            })
    `)
  }
}

startApplication()
