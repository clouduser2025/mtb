import React from 'react';
import { Button, Navbar, Nav } from 'react-bootstrap';
import { Link } from 'react-router-dom';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faUser } from '@fortawesome/free-solid-svg-icons';
import 'bootstrap/dist/css/bootstrap.min.css';
import './css/navbar.css';

const NavBar = () => {
  return (
    <>
      <Navbar expand="lg" variant="dark" className="custom-navbar bg-primary">
        <div className="container-fluid">
          <Navbar.Brand as={Link} to="/" className="text-white ms-2">
            ADPTAI
          </Navbar.Brand>
          <Navbar.Toggle aria-controls="navbar-content" />
          <Navbar.Collapse id="navbar-content">
            <div className="w-100 d-flex flex-column flex-lg-row justify-content-between align-items-center">
              <div className="center-section text-center">
                <Nav>
                  <Nav.Link as={Link} to="/" className="text-white fw-medium">
                    Multi Broker Trading Platform
                  </Nav.Link>
                </Nav>
              </div>
              <div className="right-section d-flex flex-wrap justify-content-center align-items-center">
                <Nav className="align-items-center">
                  <Link to="/profile" className="text-light me-4 text-decoration-none">
                    <FontAwesomeIcon icon={faUser} className="me-2" />
                    Admin
                  </Link>
                  <Nav.Item className="logout">
                    <Link to="/login" className="text-decoration-none">
                      <Button variant="outline-light" className="fw-bold btn-sm">
                        Logout
                      </Button>
                    </Link>
                  </Nav.Item>
                </Nav>
              </div>
            </div>
          </Navbar.Collapse>
        </div>
      </Navbar>
    </>
  );
};

export default NavBar;
