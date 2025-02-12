import {BrowserRouter as Router, Routes, Route} from 'react-router-dom';
import 'bootstrap/dist/css/bootstrap.min.css';
import './App.css';
import Layout from './components/Layout';
import Landing from './components/Landing';

function App() {
  return (
   <>
 <Router>
 <Routes>
 <Route path="/" element={<Layout />}>
 <Route path="/" element={<Landing />} />
 </Route>

 </Routes>
 </Router>
   </>
  );
}
export default App;
