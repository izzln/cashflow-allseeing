import { mount } from 'svelte';
import App from './components/App.svelte';
import './app.css';

export default mount(App, { target: document.getElementById('app')! });
